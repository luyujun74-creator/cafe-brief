(function(root){
function fit(ctx,text,width,height,max,min){
  for(let size=max;size>=min;size-=2){
    ctx.font=`${size}px Georgia`;let lines=[''];let valid=true;
    for(const ch of text){
      if(ch==='\n'){lines.push('');continue;}
      if(ctx.measureText(ch).width>width){valid=false;break;}
      if(ctx.measureText(lines.at(-1)+ch).width>width)lines.push('');
      lines[lines.length-1]+=ch;
    }
    if(valid&&lines.length*size*1.25<=height)return {size,lines};
  }return null;
}
class Asset{
 constructor(){this.version=0;this.bitmap=null;this.loading=false;}
 async load(file,decode){
  const version=++this.version;if(this.bitmap)this.bitmap.close();this.bitmap=null;this.loading=!!file;
  if(!file)return true;
  try{const bitmap=await decode(file);if(version!==this.version){bitmap.close();return false;}
    if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('图片像素超过4000万');}
    this.bitmap=bitmap;return true;
  }catch(e){if(version===this.version)throw e;return false;}
  finally{if(version===this.version)this.loading=false;}
 }
}
const api={fit,Asset};if(typeof module!=='undefined')module.exports=api;else root.Studio=api;
})(globalThis);
