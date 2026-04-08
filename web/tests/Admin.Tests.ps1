Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Assertions.ps1')
. (Join-Path $projectRoot 'app\ContentStore.ps1')

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

function Wait-ForUrl {
    param([string]$Url,[int]$TimeoutSeconds = 40)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    return $false
}

function ConvertTo-AsciiJson {
    param($Value)

    $json = $Value | ConvertTo-Json -Depth 100
    $builder = New-Object System.Text.StringBuilder
    foreach ($char in $json.ToCharArray()) {
        if ([int][char]$char -gt 127) {
            [void]$builder.AppendFormat('\\u{0:x4}', [int][char]$char)
        }
        else {
            [void]$builder.Append($char)
        }
    }

    return $builder.ToString()
}

function Invoke-AdminRequest {
    param(
        [int]$Port,
        [string]$Method,
        [string]$Path,
        $Payload = $null
    )

    $params = @{
        UseBasicParsing = $true
        Uri = ('http://127.0.0.1:{0}{1}' -f $Port, $Path)
        Method = $Method
    }

    if ($PSBoundParameters.ContainsKey('Payload') -and $null -ne $Payload) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ConvertTo-AsciiJson -Value $Payload
    }

    return Invoke-WebRequest @params
}

function Invoke-AdminJson {
    param(
        [int]$Port,
        [string]$Method,
        [string]$Path,
        $Payload = $null
    )

    $response = Invoke-AdminRequest -Port $Port -Method $Method -Path $Path -Payload $Payload
    if ([string]::IsNullOrWhiteSpace($response.Content)) {
        return $null
    }

    return ($response.Content | ConvertFrom-Json)
}

function Clone-JsonObject {
    param($Value)

    return (($Value | ConvertTo-Json -Depth 100) | ConvertFrom-Json)
}

$contentPath = Get-ContentStorePath -ProjectRoot $projectRoot
$uploadsRoot = Get-UploadsRoot -ProjectRoot $projectRoot
$originalContent = Get-Content -LiteralPath $contentPath -Raw
$serverProcess = $null
$createdUploadUrls = New-Object System.Collections.Generic.List[string]

try {
    $port = Get-FreePort
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $projectRoot 'server.ps1'), '-Port', $port) -PassThru -WindowStyle Hidden

    Write-TestStep 'Admin aliases respond on /admin and /admin/'
    Assert-True -Condition (Wait-ForUrl -Url ("http://127.0.0.1:{0}/admin" -f $port)) -Message 'Admin server did not become ready.'
    $adminPage = (Invoke-AdminRequest -Port $port -Method Get -Path '/admin').Content
    Assert-Match -Actual $adminPage -Pattern 'admin\.js'
    $adminSlashPage = (Invoke-AdminRequest -Port $port -Method Get -Path '/admin/').Content
    Assert-Match -Actual $adminSlashPage -Pattern 'admin\.js'

    Write-TestStep 'Admin content endpoint returns sections and meta'
    $content = Invoke-AdminJson -Port $port -Method Get -Path '/api/admin/content'
    Assert-True -Condition ($content.sections.Count -ge 1)
    Assert-True -Condition ($null -ne $content.meta.ui.admin)
    Assert-Equal -Expected 'Move up' -Actual ([string]$content.meta.ui.admin.actions.moveUp)
    Assert-Equal -Expected 'Move down' -Actual ([string]$content.meta.ui.admin.actions.moveDown)
    Assert-True -Condition ($null -ne $content.meta.ui.admin.templates.sectionTypes.'exercise-ask-after')
    Assert-True -Condition ($null -ne $content.meta.ui.admin.templates.sectionTypes.'exercise-answering-good')
    Assert-True -Condition ($null -ne $content.meta.runtime.practiceScreens.askAfter)
    Assert-True -Condition ($null -ne $content.meta.runtime.practiceScreens.answeringGoodExercise)

    Write-TestStep 'Admin schema editors can round-trip runtime metadata'
    $schemaDraft = Clone-JsonObject -Value $content
    $schemaDraft.meta.ui.admin.taxonomies.blockKinds | Add-Member -NotePropertyName 'schema-test-kind' -NotePropertyValue 'schema-test-kind' -Force
    $schemaDraft.meta.runtime.defaults.featuredBlockCount = 3
    $schemaDraft.meta.runtime.blockRenderers.custom = 'generic'
    $schemaDraft.meta.runtime.practiceScreens.answering.targetHrefTemplate = '/practice/answering/{mode}'
    $schemaSaved = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $schemaDraft
    Assert-Equal -Expected 'schema-test-kind' -Actual $schemaSaved.meta.ui.admin.taxonomies.blockKinds.'schema-test-kind'
    Assert-Equal -Expected 3 -Actual $schemaSaved.meta.runtime.defaults.featuredBlockCount
    Assert-Equal -Expected 'generic' -Actual $schemaSaved.meta.runtime.blockRenderers.custom
    Assert-Equal -Expected '/practice/answering/{mode}' -Actual $schemaSaved.meta.runtime.practiceScreens.answering.targetHrefTemplate

    Write-TestStep 'Admin save accepts ASCII updates'
    $content.sections[0].title = 'Admin save ' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $saved = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $content
    Assert-Equal -Expected $content.sections[0].title -Actual $saved.sections[0].title

    Write-TestStep 'Admin save round-trips meta edits and empty-string deletions'
    $metaDraft = Clone-JsonObject -Value $saved
    $newAdminTitle = 'Admin meta ' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $metaDraft.meta.ui.admin.title = $newAdminTitle
    $metaDraft.meta.ui.admin.hint = ''
    $metaDraft.meta.ui.footerNote = ''
    $metaSaved = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $metaDraft
    Assert-Equal -Expected $newAdminTitle -Actual $metaSaved.meta.ui.admin.title
    Assert-Equal -Expected '' -Actual $metaSaved.meta.ui.admin.hint
    Assert-Equal -Expected '' -Actual $metaSaved.meta.ui.footerNote

    Write-TestStep 'Admin can upload media assets'
    $imageUpload = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/media/upload' -Payload @{ fileName = 'diagram.png'; base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fake-image-bytes')) }
    $videoUpload = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/media/upload' -Payload @{ fileName = 'walkthrough.mp4'; base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fake-video-bytes')) }
    $audioUpload = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/media/upload' -Payload @{ fileName = 'voiceover.mp3'; base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('fake-audio-bytes')) }
    foreach ($upload in @($imageUpload, $videoUpload, $audioUpload)) {
        [void]$createdUploadUrls.Add([string]$upload.url)
        Assert-Match -Actual $upload.url -Pattern '^/uploads/'
        $absoluteUploadPath = Join-Path $uploadsRoot ($upload.url.Substring('/uploads/'.Length))
        Assert-True -Condition (Test-Path -LiteralPath $absoluteUploadPath -PathType Leaf)
    }

    $testId = ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $sectionId = "admin-test-section-$testId"
    $mainBlockId = "admin-test-block-main-$testId"
    $secondaryBlockId = "admin-test-block-secondary-$testId"
    $textMaterialId = "admin-text-$testId"
    $imageMaterialId = "admin-image-$testId"
    $videoMaterialId = "admin-video-$testId"
    $audioMaterialId = "admin-audio-$testId"
    $secondaryTextMaterialId = "secondary-text-$testId"
    $newMaterialId = "admin-new-material-$testId"

    Write-TestStep 'Admin can create sections, blocks and materials through the save API'
    $draft = Clone-JsonObject -Value $metaSaved
    $newSection = [PSCustomObject]@{
        id = $sectionId
        route = '/admin-test-section'
        type = 'exercise'
        eyebrow = 'Admin test section'
        title = 'Admin test section'
        summary = 'Created by the admin functional tests.'
        blocks = @(
            [PSCustomObject]@{
                id = $mainBlockId
                kind = 'practice-clarify'
                title = 'Main admin block'
                description = 'Created by the admin tests.'
                route = ''
                materials = @(
                    [PSCustomObject]@{ id = $textMaterialId; type = 'text'; title = 'Text material'; body = 'Text body: hello'; url = ''; alt = '' },
                    [PSCustomObject]@{ id = $imageMaterialId; type = 'image'; title = 'Image material'; body = 'Image description'; url = $imageUpload.url; alt = 'Diagram preview' },
                    [PSCustomObject]@{ id = $videoMaterialId; type = 'video'; title = 'Video material'; body = 'Video description'; url = $videoUpload.url; alt = 'Walkthrough' },
                    [PSCustomObject]@{ id = $audioMaterialId; type = 'audio'; title = 'Audio material'; body = 'Audio description'; url = $audioUpload.url; alt = 'Voiceover'; meta = [PSCustomObject]@{ statement = 'The deployment failed on ___.'; placeholder = 'Sorry, the deployment failed on ___?'; clarification = 'Sorry, the deployment failed on what?'; acceptedAnswers = @('Sorry, the deployment failed on what?') } }
                )
            },
            [PSCustomObject]@{
                id = $secondaryBlockId
                kind = 'custom'
                title = 'Secondary block'
                description = 'This block will be deleted later.'
                route = '/secondary'
                materials = @(
                    [PSCustomObject]@{ id = $secondaryTextMaterialId; type = 'text'; title = 'Secondary text'; body = 'Secondary body'; url = ''; alt = '' }
                )
            }
        )
    }
    $draft.sections += $newSection
    $savedWithSection = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $createdSection = $savedWithSection.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    Assert-True -Condition ($null -ne $createdSection)
    Assert-Equal -Expected 2 -Actual $createdSection.blocks.Count
    $createdMainBlock = $createdSection.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $createdSecondaryBlock = $createdSection.blocks | Where-Object { $_.id -eq $secondaryBlockId } | Select-Object -First 1
    Assert-True -Condition ($null -ne $createdMainBlock)
    Assert-True -Condition ($null -ne $createdSecondaryBlock)
    Assert-Equal -Expected 4 -Actual $createdMainBlock.materials.Count
    Assert-Equal -Expected 1 -Actual $createdSecondaryBlock.materials.Count

    Write-TestStep 'Admin can save a freshly added default material'
    $draft = Clone-JsonObject -Value $savedWithSection
    $sectionUnderEdit = $draft.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $newMaterial = [PSCustomObject]@{ id = $newMaterialId; type = 'text'; title = 'New material'; body = ''; url = ''; alt = '' }
    $sectionUnderEdit.blocks[0].materials += $newMaterial
    $saveWithNewMaterial = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $savedSectionWithNewMaterial = $saveWithNewMaterial.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $savedMainBlockWithNewMaterial = $savedSectionWithNewMaterial.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $persistedNewMaterial = $savedMainBlockWithNewMaterial.materials | Where-Object { $_.id -eq $newMaterialId } | Select-Object -First 1
    Assert-True -Condition ($null -ne $persistedNewMaterial)
    Assert-Equal -Expected 'New material' -Actual $persistedNewMaterial.title

    Write-TestStep 'Admin can edit block and material fields'
    $draft = Clone-JsonObject -Value $savedWithSection
    $sectionUnderEdit = $draft.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $mainBlockUnderEdit = $sectionUnderEdit.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $textMaterialUnderEdit = $mainBlockUnderEdit.materials | Where-Object { $_.id -eq $textMaterialId } | Select-Object -First 1
    $audioMaterialUnderEdit = $mainBlockUnderEdit.materials | Where-Object { $_.id -eq $audioMaterialId } | Select-Object -First 1
    $sectionUnderEdit.summary = ''
    $mainBlockUnderEdit.title = 'Main admin block updated'
    $textMaterialUnderEdit.body = 'Updated material body'
    $audioMaterialUnderEdit.meta.placeholder = 'Sorry, the deployment failed on what exactly?'
    $audioMaterialUnderEdit.meta.acceptedAnswers = @('Sorry, the deployment failed on what?', 'Sorry, the deployment failed on which item?')
    $updatedSectionSave = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $updatedSection = $updatedSectionSave.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $updatedMainBlock = $updatedSection.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $updatedTextMaterial = $updatedMainBlock.materials | Where-Object { $_.id -eq $textMaterialId } | Select-Object -First 1
    $updatedAudioMaterial = $updatedMainBlock.materials | Where-Object { $_.id -eq $audioMaterialId } | Select-Object -First 1
    Assert-Equal -Expected '' -Actual $updatedSection.summary
    Assert-Equal -Expected 'Main admin block updated' -Actual $updatedMainBlock.title
    Assert-Equal -Expected 'Updated material body' -Actual $updatedTextMaterial.body
    Assert-Equal -Expected 'Sorry, the deployment failed on what exactly?' -Actual ([string]$updatedAudioMaterial.meta.placeholder)
    Assert-Equal -Expected 2 -Actual @($updatedAudioMaterial.meta.acceptedAnswers).Count
    Write-TestStep 'Admin can reorder blocks and materials via save API'
    $draft = Clone-JsonObject -Value $updatedSectionSave
    $sectionUnderEdit = $draft.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $mainBlockUnderEdit = $sectionUnderEdit.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $secondaryBlockUnderEdit = $sectionUnderEdit.blocks | Where-Object { $_.id -eq $secondaryBlockId } | Select-Object -First 1
    $sectionUnderEdit.blocks = @($secondaryBlockUnderEdit, $mainBlockUnderEdit)
    $mainBlockUnderEdit.materials = @(
        ($mainBlockUnderEdit.materials | Where-Object { $_.id -eq $audioMaterialId } | Select-Object -First 1),
        ($mainBlockUnderEdit.materials | Where-Object { $_.id -eq $textMaterialId } | Select-Object -First 1),
        ($mainBlockUnderEdit.materials | Where-Object { $_.id -eq $imageMaterialId } | Select-Object -First 1),
        ($mainBlockUnderEdit.materials | Where-Object { $_.id -eq $videoMaterialId } | Select-Object -First 1)
    )
    $reorderedSave = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $reorderedSection = $reorderedSave.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $reorderedMainBlock = $reorderedSection.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    Assert-Equal -Expected $secondaryBlockId -Actual $reorderedSection.blocks[0].id
    Assert-Equal -Expected $mainBlockId -Actual $reorderedSection.blocks[1].id
    Assert-Equal -Expected $audioMaterialId -Actual $reorderedMainBlock.materials[0].id
    Assert-Equal -Expected $textMaterialId -Actual $reorderedMainBlock.materials[1].id
    Write-TestStep 'Admin can delete materials and blocks via save API'
    $draft = Clone-JsonObject -Value $updatedSectionSave
    $sectionUnderEdit = $draft.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $mainBlockUnderEdit = $sectionUnderEdit.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    $mainBlockUnderEdit.materials = @($mainBlockUnderEdit.materials | Where-Object { $_.id -ne $audioMaterialId })
    $sectionUnderEdit.blocks = @($sectionUnderEdit.blocks | Where-Object { $_.id -ne $secondaryBlockId })
    $afterDeleteSave = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $afterDeleteSection = $afterDeleteSave.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    $afterDeleteMainBlock = $afterDeleteSection.blocks | Where-Object { $_.id -eq $mainBlockId } | Select-Object -First 1
    Assert-Equal -Expected 1 -Actual $afterDeleteSection.blocks.Count
    Assert-Equal -Expected 3 -Actual $afterDeleteMainBlock.materials.Count
    Write-TestStep 'Admin can delete uploaded files'
    $deleteResult = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/media/delete' -Payload @{ url = $audioUpload.url }
    Assert-True -Condition $deleteResult.deleted
    $audioPath = Join-Path $uploadsRoot ($audioUpload.url.Substring('/uploads/'.Length))
    Assert-True -Condition (-not (Test-Path -LiteralPath $audioPath))
    [void]$createdUploadUrls.Remove([string]$audioUpload.url)

    Write-TestStep 'Admin rejects media deletes outside uploads'
    try {
        Invoke-AdminRequest -Port $port -Method Post -Path '/api/admin/media/delete' -Payload @{ url = '/not-allowed/file.txt' } | Out-Null
        throw 'Expected the invalid delete request to fail.'
    }
    catch {
        if ($_.Exception.Message -eq 'Expected the invalid delete request to fail.') { throw }
        $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        Assert-Equal -Expected 400 -Actual $statusCode
    }

    Write-TestStep 'Admin can delete sections via save API'
    $draft = Clone-JsonObject -Value $afterDeleteSave
    $draft.sections = @($draft.sections | Where-Object { $_.id -ne $sectionId })
    $afterSectionDelete = Invoke-AdminJson -Port $port -Method Post -Path '/api/admin/content' -Payload $draft
    $deletedSection = $afterSectionDelete.sections | Where-Object { $_.id -eq $sectionId } | Select-Object -First 1
    Assert-True -Condition ($null -eq $deletedSection)
}
finally {
    foreach ($url in $createdUploadUrls) {
        try {
            $absoluteUploadPath = Join-Path $uploadsRoot ($url.Substring('/uploads/'.Length))
            if (Test-Path -LiteralPath $absoluteUploadPath -PathType Leaf) {
                Remove-Item -LiteralPath $absoluteUploadPath -Force
            }
        }
        catch {
        }
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }

    Write-JsonFileText -Path $contentPath -Text $originalContent
}

Write-Host 'Admin tests passed.'


