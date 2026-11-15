import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

/** Full local rules text on hover, keyboard focus, or tap. */
export function RuleTerm({label,text}: {label:string;text:string}) {
  const id=useId();
  const [position,setPosition]=useState<CSSProperties>();
  const closing=useRef<ReturnType<typeof setTimeout>>();
  const keepOpen=()=>clearTimeout(closing.current);
  useEffect(()=>()=>clearTimeout(closing.current),[]);
  function show(element:HTMLElement){
    const rect=element.getBoundingClientRect();
    const width=Math.min(520,window.innerWidth-32);
    const below=window.innerHeight-rect.bottom;
    setPosition({left:Math.max(16,Math.min(rect.left,window.innerWidth-width-16)),width,
      ...(below>=200?{top:rect.bottom+6,maxHeight:Math.min(320,below-22)}:{bottom:window.innerHeight-rect.top+6,maxHeight:Math.max(100,rect.top-22)})});
  }
  return <span className="rule-reference" onMouseEnter={keepOpen} onMouseLeave={()=>{closing.current=setTimeout(()=>setPosition(undefined),180);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPosition(undefined);}} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setPosition(undefined);}}}>
    <button className="rule-term" type="button" aria-expanded={!!position} aria-describedby={position?id:undefined}
      onMouseEnter={e=>show(e.currentTarget)} onFocus={e=>show(e.currentTarget)} onClick={e=>show(e.currentTarget)}>{label}</button>
    {position && <span id={id} role="tooltip" tabIndex={0} className="rule-description" style={position}>{text||"No description is available in this ruleset."}</span>}
  </span>;
}
