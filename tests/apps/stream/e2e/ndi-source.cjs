const ndi=require('../../../../packages/ndi-native');
const name=process.argv[2] || 'LumaStream UI Pattern';
ndi.initializeSender({senderName:name,width:64,height:36,withAlpha:false,frameRateN:30,frameRateD:1});
const pixels=new Uint8Array(64*36*4);
for(let i=0;i<pixels.length;i+=4){pixels[i]=255;pixels[i+3]=255;}
let active=true;
const video=setInterval(()=>{if(active)ndi.sendRgbaFrame(name,pixels,64,36);},33);
let samples=0;
const audio=setInterval(()=>{if(!active)return;const pcm=new Float32Array(2048);for(let i=0;i<1024;i++){pcm[i]=Math.sin((samples+i)*2*Math.PI*440/48000)*.2;pcm[i+1024]=pcm[i];}samples+=1024;ndi.sendAudioFrame(name,pcm,48000,2,1024);},21);
console.log('READY');
process.stdin.on('data',data=>{const command=String(data).trim();if(command==='pause')active=false;else if(command==='resume')active=true;else {clearInterval(video);clearInterval(audio);ndi.destroySender(name);process.stdin.destroy();}});
process.stdin.resume();
