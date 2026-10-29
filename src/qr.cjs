const QRCode=require('qrcode');
window.renderBindingQR=(canvas,url)=>QRCode.toCanvas(canvas,url,{width:240,margin:2,errorCorrectionLevel:'M'});
