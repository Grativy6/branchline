import sharp from 'sharp';
const images=new WeakMap();
// Only a host adapter can attach pixel data. A JSON property returned by a model
// or read from a file cannot become an image, a filename to open, or a URL to fetch.
export async function withToolImage(result,bytes,signal) {
  signal?.throwIfAborted();
  if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024)throw new Error('Tool image exceeds its byte limit.');
  const info=await sharp(bytes,{limitInputPixels:4*1024*1024}).metadata();
  if(!['png','jpeg'].includes(info.format)||!info.width||!info.height||info.width>2048||info.height>2048||info.pages>1)throw new Error('Unsupported tool image.');
  signal?.throwIfAborted();images.set(result,'data:image/'+info.format+';base64,'+bytes.toString('base64'));return result;
}
export function codexToolContent(result,signal) {
  signal?.throwIfAborted();const url=images.get(result);
  return [{type:'inputText',text:JSON.stringify(result)},...(url?[{type:'inputImage',imageUrl:url}]:[])];
}
