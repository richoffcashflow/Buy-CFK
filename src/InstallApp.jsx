import React,{useEffect,useRef,useState} from 'react';

export function installationHelp({userAgent='',platform='',maxTouchPoints=0}={}){
  if(/iPhone|iPad|iPod/.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1))return 'Open this website in Safari. Tap Share, then Add to Home Screen. Leave Open as Web App enabled if shown, then tap Add.';
  if(/Android/.test(userAgent))return 'Open this website in Chrome. Tap the browser menu, then Add to Home screen or Install app.';
  return 'Use your browser’s Install app option in the address bar or menu. You can also bookmark this page.';
}
const seenKey=accountId=>'cfk_install_seen:'+accountId;
function hasSeen(accountId){try{return localStorage.getItem(seenKey(accountId))==='1';}catch{return false;}}
function rememberSeen(accountId){try{localStorage.setItem(seenKey(accountId),'1');}catch{}}
function isInstalled(){return Boolean(navigator.standalone||window.matchMedia?.('(display-mode: standalone)')?.matches);}
export default function InstallApp({accountId,eligible=false,blocked=false,Dialog}){
  const [request,setRequest]=useState(null),[showHelp,setShowHelp]=useState(false),[installed,setInstalled]=useState(isInstalled),[openFor,setOpenFor]=useState(null),[installing,setInstalling]=useState(false);
  const seen=useRef(new Set());
  useEffect(()=>{
    const standalone=window.matchMedia?.('(display-mode: standalone)');
    const update=()=>setInstalled(Boolean(navigator.standalone||standalone?.matches));
    const available=event=>{event.preventDefault();setRequest(event);};
    const complete=()=>{setInstalled(true);setRequest(null);setShowHelp(false);setOpenFor(null);};
    update();standalone?.addEventListener?.('change',update);
    window.addEventListener('beforeinstallprompt',available);window.addEventListener('appinstalled',complete);
    return()=>{standalone?.removeEventListener?.('change',update);window.removeEventListener('beforeinstallprompt',available);window.removeEventListener('appinstalled',complete);};
  },[]);
  useEffect(()=>{
    if(!accountId||!eligible||blocked||installed||seen.current.has(accountId)||hasSeen(accountId))return;
    seen.current.add(accountId);rememberSeen(accountId);setShowHelp(false);setOpenFor(accountId);
  },[accountId,eligible,blocked,installed]);
  if(installed||blocked||!eligible||!accountId||openFor!==accountId)return null;
  const dismiss=()=>setOpenFor(null);
  async function install(){
    if(installing)return;
    if(!request){setShowHelp(true);return;}
    setInstalling(true);
    try{await request.prompt();const choice=await request.userChoice;if(choice?.outcome==='accepted')setInstalled(true);dismiss();}
    catch{setShowHelp(true);}finally{setRequest(null);setInstalling(false);}
  }
  return <Dialog title="Keep CFK close" onClose={dismiss}><div className="install-prompt"><div className="install-brand"><img src="/assets/cashflow-user-logo.png" width="64" height="64" alt=""/></div><p>Add Cashflowkey to your Home Screen for quick access to your account.</p>{showHelp?<><p className="install-help">{installationHelp(navigator)}</p><button type="button" className="primary" onClick={dismiss}>Got it</button></>:<><button type="button" className="primary" onClick={install} disabled={installing}>{installing?'Opening…':'Add to Home Screen'}</button><button type="button" className="secondary" onClick={dismiss}>Not now</button></>}</div></Dialog>;
}
