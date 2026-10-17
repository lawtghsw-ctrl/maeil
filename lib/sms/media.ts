import type { SmsAdmin } from "./delivery";
import { fail } from "./delivery";
import { validateImages } from "@/services/sms-relay/src/validation.mjs";

export function imagePaths(value: unknown, firmId:string):string[] {
  if (!Array.isArray(value) || value.length>3) fail(400,"첨부 이미지는 최대 3개까지 사용할 수 있습니다.");
  const paths=value.map(item=>{
    if (typeof item!=="string" || item.length>500 || !item.startsWith(`${firmId}/`) || /[\\\x00-\x1f\x7f?#%]/.test(item) || item.split("/").some(part=>!part || part==="." || part==="..") || !/\.(?:jpe?g|png|gif)$/i.test(item)) fail(400,"해당 로펌의 문자 이미지 파일만 사용할 수 있습니다.");
    return item;
  });
  if(new Set(paths).size!==paths.length) fail(400,"같은 이미지를 중복 첨부할 수 없습니다.");
  return paths;
}
export async function loadImages(admin:SmsAdmin,paths:string[],firmId:string) {
  imagePaths(paths,firmId);
  let total=0;
  const images=[];
  const supabaseOrigin=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||"").origin;
  for (const [index,path] of paths.entries()) {
    const {data,error}=await admin.storage.from("sms-media").createSignedUrl(path,60);
    if(error || !data?.signedUrl) fail(400,"첨부 이미지를 읽지 못했습니다. 다시 첨부해주세요.");
    const url=new URL(data.signedUrl);
    if(url.protocol!=="https:" || url.origin!==supabaseOrigin || !url.pathname.startsWith("/storage/v1/object/sign/sms-media/")) fail(400,"문자 이미지 경로를 확인해주세요.");
    const response=await fetch(url.href,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
    if(!response.ok || !response.body) fail(400,"첨부 이미지를 읽지 못했습니다.");
    if(Number(response.headers.get("content-length")||0)>2*1024*1024) {await response.body.cancel();fail(400,"첨부 이미지의 총 용량은 2MB 이하여야 합니다.");}
    const reader=response.body.getReader(); const parts:Uint8Array[]=[];
    try { for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;
      if(total>2*1024*1024){await reader.cancel();fail(400,"첨부 이미지의 총 용량은 2MB 이하여야 합니다.");} parts.push(part.value);} }
    finally{reader.releaseLock();}
    const extension=path.toLowerCase().endsWith(".png")?"png":path.toLowerCase().endsWith(".gif")?"gif":"jpg";
    images.push({filename:`image${index+1}.${extension}`,contentType:extension==="jpg"?"image/jpeg":`image/${extension}`,base64:Buffer.concat(parts).toString("base64")});
  }
  try {validateImages(images,paths.length?"MMS":"SMS");} catch {fail(400,"이미지 형식 또는 용량을 확인해주세요. JPEG·PNG·GIF만 사용할 수 있습니다.");}
  return images;
}
