const { chromium } = require('/tmp/pw/node_modules/playwright');
const BASE='http://localhost:3000'; const OUT='/tmp/shots/'; require('fs').mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1600,height:950}}); const errs=[];
  p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  p.on('dialog', d=>{ console.log('confirm:', d.message()); d.accept(); });
  await p.goto(BASE+'/login'); const i=p.locator('input'); await i.nth(0).fill('admin'); await i.nth(1).fill('Admin@123'); await p.keyboard.press('Enter'); await p.waitForTimeout(3000);
  await p.goto(BASE+'/quan-tri/mau-in'); await p.waitForTimeout(2000);
  await p.getByRole('button',{name:'Thêm mẫu in'}).first().click(); await p.waitForTimeout(1500);
  await p.screenshot({path:OUT+'n1.png'});
  await p.locator('#t-code').fill('TEST_'+Date.now()); await p.locator('#t-name').fill('Mẫu thử R10');
  await p.getByRole('button',{name:'Xong'}).click(); await p.waitForTimeout(300);
  const page=p.locator('[data-testid="print-page"]');
  for (const [t,x,y] of [['text',150,150],['text',300,260],['qrcode',500,400],['table',150,500]]) { await p.locator(`[data-testid="tool-${t}"]`).dragTo(page,{targetPosition:{x,y}}); await p.waitForTimeout(250); }
  console.log('els', await p.locator('[data-el-id]').count());
  // marquee select all via Ctrl+A then align left
  await page.click({position:{x:700,y:900}}); await p.keyboard.press('Control+a'); await p.waitForTimeout(200);
  await p.getByRole('button',{name:'Bố trí',exact:true}).click(); await p.getByTitle('Căn trái').first().click(); await p.waitForTimeout(300);
  const xs = await p.$$eval('[data-el-id]', els=>els.map(e=>Math.round(e.getBoundingClientRect().left))); console.log('lefts after align', xs);
  // inline edit on first text
  const first=p.locator('[data-el-id]').first(); await first.dblclick(); await p.waitForTimeout(300);
  const ta=p.locator('[data-testid="print-page"] textarea'); console.log('inline editor', await ta.count());
  if (await ta.count()) { await ta.fill('Xin chào {request.patientName}'); await p.keyboard.press('Control+Enter'); }
  await p.waitForTimeout(300);
  await first.click({button:'right'}); await p.waitForTimeout(300); await p.screenshot({path:OUT+'n2-menu.png'});
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+s'); await p.waitForTimeout(1500);
  console.log('toast', (await p.locator('[data-sonner-toast]').allInnerTexts()).join('|'));
  await p.getByRole('button',{name:'Xem',exact:true}).click(); await p.getByRole('button',{name:/Hiện dữ liệu mẫu/}).click(); await p.waitForTimeout(500);
  await p.screenshot({path:OUT+'n3.png'});
  // modify then close -> confirm
  await p.locator('[data-el-id]').first().click(); await p.keyboard.press('ArrowRight');
  await p.getByTitle('Đóng trình thiết kế').click(); await p.waitForTimeout(1500);
  console.log('back to list rows', await p.locator('tbody tr').count());
  console.log('errors:', errs.slice(0,10)); await b.close();
})();
