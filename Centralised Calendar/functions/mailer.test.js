const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const nodemailer=require('nodemailer');
const selfsigned=require('selfsigned');
const { SMTPServer }=require('smtp-server');
const {smtpTransportOptions,sendWithTransport}=require('./mailer');

test('SMTP enforces implicit TLS on 465 and STARTTLS with certificate checks on 587',()=>{
 const implicit=smtpTransportOptions({host:'smtp.example.invalid',port:465,user:'u',pass:'p'});
 assert.equal(implicit.secure,true);
 assert.equal(implicit.requireTLS,false);
 assert.deepEqual(implicit.tls,{rejectUnauthorized:true});
 const starttls=smtpTransportOptions({host:'smtp.example.invalid',port:587,user:'u',pass:'p'});
 assert.equal(starttls.secure,false);
 assert.equal(starttls.requireTLS,true);
 assert.deepEqual(starttls.tls,{rejectUnauthorized:true});
 assert.throws(()=>smtpTransportOptions({host:'smtp.example.invalid',port:25,user:'u',pass:'p'}),/implicit TLS|STARTTLS/);
});

test('SMTP rejects a server without STARTTLS before AUTH or message content',async()=>{
 const commands=[];
 const server=net.createServer(socket=>{
  socket.write('220 local test server\r\n');
  let pending='';
  socket.on('data',data=>{
   pending+=data.toString('utf8');
   while(pending.includes('\r\n')){
    const end=pending.indexOf('\r\n');
    const line=pending.slice(0,end);pending=pending.slice(end+2);commands.push(line);
    if(/^EHLO /i.test(line))socket.write('250-local test server\r\n250 SIZE 100000\r\n');
    else if(/^QUIT/i.test(line)){socket.write('221 bye\r\n');socket.end();}
    else socket.write('250 ok\r\n');
   }
  });
 });
 server.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const address=server.address();
 const transport=nodemailer.createTransport({
  ...smtpTransportOptions({host:'127.0.0.1',port:587,user:'not-sent',pass:'not-sent'}),
  port:address.port,
  connectionTimeout:2000,greetingTimeout:2000,socketTimeout:2000
 });
 try{
  await assert.rejects(transport.sendMail({from:'sender@example.invalid',to:'recipient@example.invalid',subject:'not sent',text:'not sent'}));
  assert.ok(commands.some(line=>/^EHLO /i.test(line)));
  assert.ok(!commands.some(line=>/^(AUTH|MAIL FROM:|RCPT TO:|DATA)\b/i.test(line)));
 }finally{
  transport.close();
  await new Promise(resolve=>server.close(resolve));
 }
});

test('SMTP sends only after a trusted STARTTLS handshake succeeds',async()=>{
 const generated=await selfsigned.generate(
  [{name:'commonName',value:'localhost'}],
  {keySize:2048,days:1,extensions:[{name:'subjectAltName',altNames:[{type:2,value:'localhost'}]}]}
 );
 const messages=[];
 const server=new SMTPServer({
  secure:false,key:generated.private,cert:generated.cert,
  onAuth(auth,_session,callback){callback(null,{user:auth.username});},
  onData(stream,_session,callback){
   let message='';
   stream.setEncoding('utf8');
   stream.on('data',chunk=>{message+=chunk;});
   stream.on('end',()=>{messages.push(message);callback(null,'accepted');});
  }
 });
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
 const address=server.server.address();
 const transport=nodemailer.createTransport({
  ...smtpTransportOptions({host:'localhost',port:587,user:'local-test',pass:'local-test'}),
  port:address.port,
  tls:{rejectUnauthorized:true,ca:generated.cert},
  connectionTimeout:5000,greetingTimeout:5000,socketTimeout:5000
 });
 try{
  const result=await transport.sendMail({
   from:'sender@example.invalid',to:'recipient@example.invalid',
   subject:'local TLS verification',text:'Synthetic message; no external delivery'
  });
  assert.equal(result.accepted.length,1);
  assert.equal(messages.length,1);
  assert.match(messages[0],/Synthetic message; no external delivery/);
 }finally{
  transport.close();
  await new Promise(resolve=>server.close(resolve));
 }
});

test('delivery helper reports both accepted and failed transports accurately',async()=>{
 const errors=[];
 const logger={error:(message,details)=>errors.push({message,details})};
 assert.deepEqual(await sendWithTransport({sendMail:async()=>{}},{to:'a@example.org',subject:'sent'},'from@example.org',logger),{sent:true});
 assert.deepEqual(await sendWithTransport({sendMail:async()=>{throw new Error('rejected')}} ,{to:'a@example.org',subject:'failed'},'from@example.org',logger),{sent:false,reason:'send-error'});
 assert.equal(errors.length,1);
 assert.doesNotMatch(JSON.stringify(errors),/not-sent|password/i);
});
