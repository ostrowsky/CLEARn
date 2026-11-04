export function saveBackupFile(file: {blob: Blob; fileName: string}) {
 if(typeof document==='undefined')throw new Error('Backup download requires a web browser.');
 const url=URL.createObjectURL(file.blob),link=document.createElement('a');
 link.href=url;link.download=file.fileName;document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
