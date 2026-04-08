$env:SOFTSKILLS_LLM_API_KEY = 'sk-your-key-here'
$env:SOFTSKILLS_LLM_MODEL = 'gpt-4o-mini'
# Optional for OpenAI-compatible gateways:
# $env:SOFTSKILLS_LLM_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

powershell -ExecutionPolicy Bypass -File .\web\open-local.ps1

