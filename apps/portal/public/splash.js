// Splash-screen particle animation. Lives in a separate file (not inline in
// index.html) so the SPA HTML CSP can use script-src 'self' without
// 'unsafe-inline'. Cleanup is exposed as window.__splashCleanup for main.tsx.
(function() {
  var c = document.getElementById("splash-canvas");
  if (!c) return;
  var ctx = c.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var pts = [], stars = [], raf;

  function resize() {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function mkPt() {
    var g = Math.random() > 0.6;
    return { x: Math.random()*innerWidth, y: Math.random()*innerHeight, vx: (Math.random()-.5)*.25, vy: -Math.random()*.2-.03, r: Math.random()*1.4+.3, a: Math.random()*.35+.05, p: Math.random()*Math.PI*2, c: g?"191,155,80":"148,163,184" };
  }

  function mkStar() {
    var spd = 4+Math.random()*6, e = Math.random(), x, y, ang;
    if (e < .5) { x = Math.random()*innerWidth; y = -10; ang = Math.PI*.15+Math.random()*Math.PI*.2; }
    else if (e < .75) { x = -10; y = Math.random()*innerHeight*.7; ang = Math.PI*.05+Math.random()*Math.PI*.15; }
    else { x = innerWidth+10; y = Math.random()*innerHeight*.7; ang = Math.PI-(Math.PI*.05+Math.random()*Math.PI*.15); }
    return { x:x, y:y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd, life:1, decay:.008+Math.random()*.008, len:80+Math.random()*100, w:1.5+Math.random()*1.5, gold:Math.random()>.5 };
  }

  function draw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    var w = innerWidth, h = innerHeight;
    for (var i=0; i<pts.length; i++) {
      var p=pts[i]; p.x+=p.vx; p.y+=p.vy; p.p+=.01;
      if(p.x<0)p.x=w; if(p.x>w)p.x=0; if(p.y<-10){p.y=h+10;p.x=Math.random()*w;}
      var a=p.a*(.5+.5*Math.sin(p.p));
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle="rgba("+p.c+","+a+")"; ctx.fill();
    }
    for (var i=0; i<pts.length; i++) for (var j=i+1; j<pts.length; j++) {
      var dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=dx*dx+dy*dy;
      if(d<14000){ctx.strokeStyle="rgba(191,155,80,"+((1-d/14000)*.035)+")";ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();}
    }
    if(stars.length<8 && Math.random()<.03) stars.push(mkStar());
    for (var i=stars.length-1; i>=0; i--) {
      var s=stars[i]; s.x+=s.vx; s.y+=s.vy; s.life-=s.decay;
      if(s.life<=0||s.x<-60||s.x>w+60||s.y>h+60){stars.splice(i,1);continue;}
      var mag=Math.sqrt(s.vx*s.vx+s.vy*s.vy), tx=s.x-(s.vx/mag)*s.len, ty=s.y-(s.vy/mag)*s.len;
      var g=ctx.createLinearGradient(tx,ty,s.x,s.y);
      if(s.gold){g.addColorStop(0,"rgba(191,155,80,0)");g.addColorStop(.4,"rgba(212,184,120,"+(s.life*.5)+")");g.addColorStop(.8,"rgba(235,210,160,"+(s.life*.8)+")");g.addColorStop(1,"rgba(255,245,220,"+s.life+")");}
      else{g.addColorStop(0,"rgba(148,163,184,0)");g.addColorStop(.4,"rgba(200,210,220,"+(s.life*.5)+")");g.addColorStop(.8,"rgba(230,240,255,"+(s.life*.8)+")");g.addColorStop(1,"rgba(255,255,255,"+s.life+")");}
      ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(s.x,s.y);ctx.strokeStyle=g;ctx.lineWidth=s.w*s.life;ctx.lineCap="round";ctx.stroke();
      var ha=s.life*.6, hc=s.gold?"212,184,120":"220,230,255";
      ctx.beginPath();ctx.arc(s.x,s.y,s.w*s.life*3,0,Math.PI*2);ctx.fillStyle="rgba("+hc+","+ha+")";ctx.fill();
      ctx.beginPath();ctx.arc(s.x,s.y,s.w*s.life*6,0,Math.PI*2);ctx.fillStyle="rgba("+hc+","+(ha*.12)+")";ctx.fill();
    }
    raf=requestAnimationFrame(draw);
  }

  resize();
  for(var i=0;i<80;i++) pts.push(mkPt());
  draw();
  addEventListener("resize",resize);
  window.__splashCleanup=function(){cancelAnimationFrame(raf);removeEventListener("resize",resize);};
})();
