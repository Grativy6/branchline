export const EASEL_PROFILE='branchline.easel/1';
export const EASEL_LIMITS=Object.freeze({side:2048,marks:200,points:24000,text:1500,prompt:4000,revisions:500});
const fail=(ok,why)=>{if(!ok)throw new Error('Easel: '+why);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
export const validEaselId=v=>typeof v==='string'&&/^[a-z]+_[a-f0-9-]{36}$/.test(v);
export const validColor=v=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v);
export function validateEaselDoc(doc,width,height,assetIds){
 fail(exact(doc,['assetId','marks','boundary']),'invalid drawing fields.');
 fail(assetIds.includes(doc.assetId),'that picture does not belong to this project.');
 fail(Array.isArray(doc.marks)&&doc.marks.length<=EASEL_LIMITS.marks,'too many marks; save a picture and begin another drawing.');
 const ids=new Set();let points=0;
 const coordinates=(p,min)=>{fail(Array.isArray(p)&&p.length>=min&&p.length%2===0,'invalid drawn points.');points+=p.length/2;fail(points<=EASEL_LIMITS.points,'the drawing has too many points.');for(let i=0;i<p.length;i++)fail(finite(p[i],0,i%2?height:width),'a point is outside the canvas.');};
 for(const m of doc.marks){
  fail(validEaselId(m?.id)&&!ids.has(m.id)&&validColor(m.color),'invalid mark.');ids.add(m.id);
  if(m.type==='stroke'){fail(exact(m,['id','type','color','size','points'])&&finite(m.size,1,64),'invalid brush stroke.');coordinates(m.points,4);}
  else if(m.type==='text'){fail(exact(m,['id','type','color','size','x','y','text'])&&finite(m.size,8,144)&&finite(m.x,0,width)&&finite(m.y,0,height)&&typeof m.text==='string'&&m.text.length<=EASEL_LIMITS.text,'invalid text mark.');}
  else fail(false,'unknown mark type.');
 }
 if(doc.boundary!==null){coordinates(doc.boundary,6);fail(Math.abs(polygonArea(doc.boundary))>=4,'draw a closed area with some room inside.');}
 return doc;
}
export function polygonArea(points){let a=0;for(let i=0;i<points.length;i+=2){const j=(i+2)%points.length;a+=points[i]*points[j+1]-points[j]*points[i+1];}return a/2;}
export function pointInBoundary(x,y,points){
 if(points===null)return true;let inside=false;
 for(let i=0,j=points.length-2;i<points.length;j=i,i+=2){const xi=points[i],yi=points[i+1],xj=points[j],yj=points[j+1];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}
 return inside;
}
export function simplifyPoints(points,distance=2){
 if(points.length<=4)return points.slice();const out=points.slice(0,2);
 for(let i=2;i<points.length-2;i+=2)if(Math.hypot(points[i]-out.at(-2),points[i+1]-out.at(-1))>=distance)out.push(points[i],points[i+1]);
 out.push(...points.slice(-2));return out;
}
