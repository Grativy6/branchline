import sharp from 'sharp';
import {pointInBoundary} from '../public/easel-format.js';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function renderGuidance(base,doc,width,height,{boundary=false}={}){
 const marks=doc.marks.map(m=>m.type==='stroke'?`<polyline points="${m.points.reduce((a,v,i)=>a+(i%2?',':' ')+v,'').trim()}" fill="none" stroke="${m.color}" stroke-width="${m.size}" stroke-linecap="round" stroke-linejoin="round"/>`:`<text x="${m.x}" y="${m.y+m.size}" font-family="Arial" font-size="${m.size}" fill="${m.color}">${m.text.split('\n').map((line,i)=>`<tspan x="${m.x}" dy="${i?m.size*1.2:0}">${esc(line)}</tspan>`).join('')}</text>`).join('');
 const outline=boundary&&doc.boundary?`<polygon points="${doc.boundary.reduce((a,v,i)=>a+(i%2?',':' ')+v,'').trim()}" fill="none" stroke="#f22e70" stroke-width="3" stroke-dasharray="8 5"/>`:'';
 if(!marks&&!outline)return base;
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}${outline}</svg>`);
 return sharp(base).composite([{input:svg}]).png().toBuffer();
}
export async function makeViewingFrame(bytes,width,height){
 const side=1024,scale=Math.min(side/width,side/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 const left=Math.floor((side-w)/2),top=Math.floor((side-h)/2);
 const view=await sharp(bytes).resize(w,h,{fit:'fill'}).extend({left,right:side-w-left,top,bottom:side-h-top,background:'#ffffff'}).png().toBuffer();
 return {bytes:view,transform:{width,height,side,left,top,viewWidth:w,viewHeight:h}};
}
export async function compositeProposal(base,generated,boundary,transform){
 const {width,height,side,left,top,viewWidth,viewHeight}=transform;
 const info=await sharp(generated,{limitInputPixels:20000000}).metadata();
 if(!info.width||info.width!==info.height||(info.pages??1)!==1)throw new Error('Easel: the provider returned a different canvas shape. The picture was not stretched or applied.');
 // Sharp retains only the last resize in a pipeline. Materialize the provider
 // frame before undoing its padding, then scale the extracted image uniformly.
 const frame=await sharp(generated).resize(side,side).png().toBuffer();
 const patch=await sharp(frame).extract({left,top,width:viewWidth,height:viewHeight}).resize(width,height).toColourspace('srgb').ensureAlpha().raw().toBuffer();
 const original=await sharp(base).ensureAlpha().raw().toBuffer();const out=Buffer.from(original);let changed=0,allowed=0,blendPixels=0,hard=null,soft=null;
 if(boundary){
  const points=boundary.reduce((a,v,i)=>a+(i%2?',':' ')+v,'').trim();
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${points}" fill="white" fill-rule="evenodd"/></svg>`);
  const coverage=await sharp(svg).ensureAlpha().extractChannel(3).raw().toBuffer();hard=Buffer.alloc(width*height);
  // Rasterize once. Exact center tests are needed only along antialiased edges,
  // keeping a long freehand boundary out of the per-pixel inner loop.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;hard[i]=coverage[i]===255?255:coverage[i]&&pointInBoundary(x+.5,y+.5,boundary)?255:0;}
  const xs=boundary.filter((_,i)=>i%2===0),ys=boundary.filter((_,i)=>i%2);
  blendPixels=Math.min(32,(Math.max(...xs)-Math.min(...xs))/8,(Math.max(...ys)-Math.min(...ys))/8);
  soft=await sharp(hard,{raw:{width,height,channels:1}}).greyscale().blur(Math.max(.3,blendPixels/3)).raw().toBuffer();
 }
 // The native blur's integer approximation can slightly reduce even a flat
 // white interior. Normalize its peak so only the edge is feathered.
 const peak=soft?soft.reduce((max,value)=>Math.max(max,value),129):255;
 for(let i=0;i<width*height;i++)if(!hard||hard[i]){
  allowed++;const weight=soft?Math.max(0,Math.min(1,(soft[i]-128)/(peak-128))):1;if(weight===0)continue;
  const offset=i*4;let differs=false;const a0=original[offset+3]/255,a1=patch[offset+3]/255,alpha=a0*(1-weight)+a1*weight;
  for(let c=0;c<4;c++){const value=c===3?Math.round(alpha*255):alpha?Math.round((original[offset+c]*a0*(1-weight)+patch[offset+c]*a1*weight)/alpha):patch[offset+c];if(out[offset+c]!==value)differs=true;out[offset+c]=value;}if(differs)changed++;
 }
 return {bytes:await sharp(out,{raw:{width,height,channels:4}}).png().toBuffer(),changedPixels:changed,allowedPixels:allowed,outsidePixelsPreserved:true,blendPixels};
}
