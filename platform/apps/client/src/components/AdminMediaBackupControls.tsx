import {useState} from 'react';
import {Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import type {AppContent} from '@clearn/domain';
import {apiClient,downloadAdminBackup} from '../lib/api';
import {saveBackupFile} from '../lib/backupDownload';
import {staticContent} from '../lib/staticContent';
import {getNestedString,getUiConfig} from '../lib/contentMeta';
import {tokens} from '../theme/tokens';
function pickMediaBackupFile(){
 return new Promise<{fileName:string;base64:string}|null>(resolve=>{
  const input=document.createElement('input');input.type='file';input.accept='.zip,.json,application/zip,application/json';
  input.oncancel=()=>resolve(null);
  input.onchange=()=>{const file=input.files?.[0];if(!file){resolve(null);return;}const reader=new FileReader();reader.onload=()=>resolve({fileName:file.name,base64:String(reader.result||'')});reader.onerror=()=>resolve(null);reader.readAsDataURL(file);};input.click();
 });
}
export function AdminMediaBackupControls({authenticated=false,content,onStatus}:{authenticated?:boolean;content?:AppContent|null;onStatus?:(text:string,kind:'success'|'error')=>void}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const ui=getUiConfig(content),defaults=getUiConfig(staticContent);
 const copy=(group:string,key:string)=>getNestedString(ui,['admin',group,key],getNestedString(defaults,['admin',group,key]));
 if(Platform.OS!=='web'||typeof window==='undefined'||window.location.pathname!=='/admin'||!authenticated)return null;
 async function run(restore:boolean){
  if(busy)return;setBusy(true);setStatus('');
  try{
   if(restore){const file=await pickMediaBackupFile();if(!file)return;await apiClient.restoreAdminMediaBackup(file.fileName,file.base64);}
   else saveBackupFile(await downloadAdminBackup(true));
   const message=copy('messages',restore?'backupRestored':'backupDownloadStarted');setStatus(message);onStatus?.(message,'success');
  }catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message);onStatus?.(message,'error');}
  finally{setBusy(false);}
 }
 return <View><View style={styles.row}>
  <Pressable style={styles.button} disabled={busy} onPress={()=>void run(false)}><Text style={styles.buttonText}>{copy('actions','downloadMediaBackup')}</Text></Pressable>
  <Pressable style={styles.button} disabled={busy} onPress={()=>void run(true)}><Text style={styles.buttonText}>{copy('actions','restoreMediaBackup')}</Text></Pressable>
 </View>{status&&!onStatus?<Text accessibilityRole="alert">{status}</Text>:null}</View>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',flexWrap:'wrap',gap:tokens.spacing.sm},button:{paddingHorizontal:18,paddingVertical:12,borderRadius:tokens.radius.pill,backgroundColor:tokens.colors.surfaceStrong,borderWidth:1,borderColor:tokens.colors.cardLine},buttonText:{color:tokens.colors.ink,fontWeight:'800'}});
