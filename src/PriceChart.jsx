import React,{useEffect,useState} from 'react';
import {formatMoney} from './utils.js';

export default function PriceChart({points,message}){
  const [selected,setSelected]=useState(null);
  useEffect(()=>setSelected(null),[points]);
  const values=points.map(p=>p[4]),low=Math.min(...values),high=Math.max(...values),span=high-low||high*.08||1;
  const x=i=>points.length>1?i/(points.length-1)*560:280,y=v=>112-(v-low)/span*90;
  const path=values.map((v,i)=>(i?'L':'M')+x(i)+','+y(v)).join(' ');
  const index=selected??Math.max(0,points.length-1),point=points[index];
  const time=p=>new Date(p[0]*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const inspect=e=>{const b=e.currentTarget.getBoundingClientRect();setSelected(Math.max(0,Math.min(points.length-1,Math.round((e.clientX-b.left)/b.width*(points.length-1)))));};
  return <div className="chart" aria-label="CFK price history in US dollars">
    <div className="chart-grid" aria-hidden="true"><i/><i/><i/></div>
    {point?<><svg viewBox="0 0 560 132" preserveAspectRatio="none" role="img" aria-label={'CFK price. Low '+formatMoney(low,true)+', high '+formatMoney(high,true)} onPointerDown={inspect} onPointerMove={inspect} onPointerLeave={()=>setSelected(null)}>
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#237db7" stopOpacity=".22"/><stop offset="100%" stopColor="#237db7" stopOpacity="0"/></linearGradient></defs>
      {points.length>1&&<><path d={path+' L560,132 L0,132 Z'} fill="url(#chart-fill)"/><path d={path} fill="none" stroke="#237db7" strokeWidth="3" vectorEffect="non-scaling-stroke"/></>}
      <line x1={x(index)} y1="0" x2={x(index)} y2="132" stroke="#9bb3c2" strokeDasharray="3 4" opacity={selected===null?0:1}/>
      <circle cx={x(index)} cy={y(point[4])} r="3.5" fill="#237db7" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
    </svg><div className="chart-inspection">{selected===null?<span>{points.length===1?'First price recorded':'Press and drag to inspect'}</span>:<strong>{formatMoney(point[4],true)} <span>· {time(point)}</span></strong>}</div><div className="chart-dates"><span>{time(points[0])}</span><span>USD</span><span>{time(points.at(-1))}</span></div><input className="chart-keyboard" type="range" min="0" max={points.length-1} value={index} aria-label="Inspect a historical CFK price" aria-valuetext={formatMoney(point[4],true)+' at '+time(point)} onChange={e=>setSelected(Number(e.target.value))}/></>:<div className="chart-empty"><span>{message}</span><small>Confirmed prices will appear here.</small></div>}
  </div>;
}
