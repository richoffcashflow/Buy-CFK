import React,{useEffect,useState} from 'react';

export function installationHelp({userAgent='',platform='',maxTouchPoints=0}={}){
  if(/iPhone|iPad|iPod/.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1))return 'Open this website in Safari. Tap Share, then Add to Home Screen. Leave Open as Web App enabled if shown, then tap Add.';
  if(/Android/.test(userAgent))return 'Open this website in Chrome. Tap the browser menu, then Add to Home screen or Install app.';
  return 'Use your browser’s Install app option in the address bar or menu. You can also bookmark this page.';
}
export default function InstallApp(){
  const [request,setRequest]=useState(null),[showHelp,setShowHelp]=useState(false),[installed,setInstalled]=useState(false);
  useEffect(()=>{
    const standalone=window.matchMedia?.('(display-mode: standalone)');
    const update=()=>setInstalled(Boolean(navigator.standalone||standalone?.matches));
    const available=event=>{event.preventDefault();setRequest(event);};
    const complete=()=>{setInstalled(true);setRequest(null);setShowHelp(false);};
    update();standalone?.addEventListener?.('change',update);
    window.addEventListener('beforeinstallprompt',available);window.addEventListener('appinstalled',complete);
    return()=>{standalone?.removeEventListener?.('change',update);window.removeEventListener('beforeinstallprompt',available);window.removeEventListener('appinstalled',complete);};
  },[]);
  if(installed)return null;
  async function install(){
    if(!request){setShowHelp(value=>!value);return;}
    try{await request.prompt();const choice=await request.userChoice;if(choice?.outcome==='accepted')setInstalled(true);}
    catch{setShowHelp(true);}finally{setRequest(null);}
  }
  return <div className="install-app"><button type="button" className="install-button" onClick={install} aria-expanded={showHelp}>Add to Home Screen</button>{showHelp&&<div className="install-help"><p>{installationHelp(navigator)}</p><p>Adding the app is optional. An internet connection is required for prices, payments, and trades.</p><button type="button" onClick={()=>setShowHelp(false)}>Got it</button></div>}</div>;
}
