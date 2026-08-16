(async()=>{
  const APP='https://aluf-hakelim-v2-ready.vercel.app';
  const target=APP+'/supplier-deep-capture.html';
  let w=null;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const T=e=>String(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
  const parseText=t=>{try{return JSON.parse(t)}catch{}const a=t.indexOf('('),b=t.lastIndexOf(')');if(a>=0&&b>a){try{return JSON.parse(t.slice(a+1,b))}catch{}}return null};
  const clone=(v,d=0,seen=new WeakSet())=>{if(v==null||typeof v==='number'||typeof v==='boolean')return v;if(typeof v==='string')return v.slice(0,1800);if(typeof v!=='object')return String(v).slice(0,300);if(d>7)return '[depth]';if(seen.has(v))return '[circular]';seen.add(v);if(Array.isArray(v))return v.slice(0,120).map(x=>clone(x,d+1,seen));const o={};for(const k of Object.keys(v).slice(0,220)){try{o[k]=clone(v[k],d+1,seen)}catch{o[k]='[unreadable]'}}return o};
  const resultOf=p=>p?.data?.result||p?.data?.data?.result||p?.result||null;
  const urlsOf=win=>{try{return win.performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/acs\.aliexpress\.com\/h5\/mtop\.aliexpress\.pdp\.pc\.query/i.test(u))}catch{return[]}};
  const fetchParsed=async(win,url)=>{const r=await win.fetch(url,{credentials:'include',cache:'no-store'});const text=await r.text();return {r,text,parsed:parseText(text),url}};
  const pathMatches=(sku,pairs)=>{const sid=String(sku?.selectedSkuIdStr||sku?.selectedSkuId||'');const paths=Array.isArray(sku?.skuPaths)?sku.skuPaths:[];const sp=paths.find(x=>String(x?.skuIdStr||x?.skuId||'')===sid);if(!sp)return false;const parts=String(sp.path||'').split(';');return pairs.every(p=>parts.includes(p))};
  const targetFromSku=(sku,pairs)=>{const paths=Array.isArray(sku?.skuPaths)?sku.skuPaths:[];const sp=paths.find(x=>{const parts=String(x?.path||'').split(';');return pairs.every(p=>parts.includes(p))});return sp?String(sp.skuIdStr||sp.skuId||''):''};
  const findResponse=async(win,pairs,targetSku='',rounds=18)=>{
    const checked=new Set();let fallback=null,lastErr='';
    for(let round=0;round<rounds;round++){
      const urls=urlsOf(win).slice().reverse();
      for(const url of urls){
        if(checked.has(url)&&round<rounds-2)continue;
        checked.add(url);
        try{
          const got=await fetchParsed(win,url);if(!got.parsed)continue;
          const result=resultOf(got.parsed),sku=result?.SKU||result?.SKU_PC||null;if(!sku)continue;
          if(!fallback)fallback={...got,result,sku};
          const sid=String(sku.selectedSkuIdStr||sku.selectedSkuId||'');
          if((!targetSku||sid===targetSku)&&pathMatches(sku,pairs))return {...got,result,sku,checkedCount:checked.size};
        }catch(e){lastErr=String(e?.message||e)}
      }
      await sleep(500);
    }
    return {fallback,checkedCount:checked.size,lastErr};
  };
  const buildData=(got,meta)=>{
    const {pid,pageUrl,variant,selectedHtml,attrs}=meta;const {url:pdpUrl,r,text,parsed}=got;
    const matches=[];let walked=0;const seen=new WeakSet();const wanted=/^(PRICE|PRICE_PC|PRICE_EXTEND|SKU|SKU_PC|SKU_PRICE|SKU_PRICE_LIST|SKU_PROP|SKU_PROPERTY|QUANTITY|QUANTITY_PC|SHIPPING|SHIPPING_PC|DELIVERY|INVENTORY)$/i;const keyish=/(sku|price|quantity|inventory|shipping|delivery)/i;
    const walk=(o,path,d)=>{if(!o||typeof o!=='object'||d>12||walked++>60000||seen.has(o))return;seen.add(o);let keys=[];try{keys=Object.keys(o)}catch{return}for(const k of keys){let v;try{v=o[k]}catch{continue}const p=path?path+'.'+k:k;if(wanted.test(k)&&v&&typeof v==='object'&&matches.length<40)matches.push({global:'pdp_response',path:p,snapshot:clone(v)});if(v&&typeof v==='object')walk(v,p,d+1)}if(matches.length<40&&keys.some(k=>keyish.test(k))&&keys.some(k=>/productId|itemId|skuId|skuIdStr|totalAvailableInventory|formattedAmount|shippingFee/i.test(k))){try{const s=clone(o);const id=String(o.productId??o.itemId??'');const sk=String(o.skuId??o.skuIdStr??'');if(id===pid||sk)matches.push({global:'pdp_response',path:path||'root',skuId:sk||null,snapshot:s})}catch{}}};walk(parsed,'root',0);
    const snippets=[];const addSnippet=(label,re)=>{const m=re.exec(text);if(!m)return;const at=m.index;snippets.push(label+': '+text.slice(Math.max(0,at-500),Math.min(text.length,at+1500)).replace(/\s+/g,' ').slice(0,1900))};addSnippet('selected-sku',new RegExp('1200\\d{10,20}'));addSnippet('quantity',/totalAvailableInventory/i);addSnippet('price',/(PRICE_PC|SKU_PRICE|formattedAmount|salePrice|activityAmount)/i);addSnippet('shipping',/(shippingFee|SHIP(PING)?_PC|deliveryOptionCode)/i);
    const u=new URL(pdpUrl);return {pageUrl,productId:pid,variant,selectedHtml,selectedAttributes:attrs.slice(0,30),globals:['pdp_response_v2'],cacheMatches:matches.slice(0,36),resourcePaths:[{host:u.hostname,path:u.pathname,queryKeys:[...u.searchParams.keys()]}],networkBodies:[{host:u.hostname,path:u.pathname,status:r.status,queryKeys:[...u.searchParams.keys()],snippets}],counts:{selected:attrs.filter(x=>x.startsWith('data-sku-col=')).length,roots:1,walked,cacheMatches:matches.length,resources:got.checkedCount||1,networkBodies:1,liveRunner:true},capturedAt:new Date().toISOString()};
  };
  try{
    w=window.open('about:blank','_blank');if(!w){alert('הדפדפן חסם חלון חדש');return}
    const pageUrl=document.querySelector('link[rel=canonical]')?.href||location.href;const pid=(pageUrl.match(/(?:item\/|product\/)(\d{8,20})\.html/i)||location.href.match(/(?:item\/|product\/)(\d{8,20})\.html/i)||[])[1]||'';if(!pid)throw new Error('לא נמצא Product ID');
    const selected=[...document.querySelectorAll('[aria-checked="true"],[aria-selected="true"],[class*="sku-item--selected"],[class*="sku-item"][class*="selected"]')].filter(e=>e.getAttribute('data-sku-col')||String(e.className||'').toLowerCase().includes('sku')||e.closest('[class*="sku"]'));
    const labels=[],attrs=[],pairs=[];for(const e of selected){let t=e.getAttribute('title')||e.getAttribute('aria-label')||e.querySelector('img')?.alt||T(e);t=String(t||'').trim();if(t&&t.length<120&&!labels.includes(t))labels.push(t);for(const a of [...(e.attributes||[])]){const s=a.name+'='+String(a.value||'').slice(0,240);attrs.push(s);const m=s.match(/^data-sku-col=(\d+)-(\d+)$/i);if(m)pairs.push(m[1]+':'+m[2])}}
    const chosenPairs=[...new Set(pairs)],variant=labels.slice(0,6).join(' / '),selectedHtml=selected.map(e=>String(e.outerHTML||'')).join('\n').slice(0,7000);if(!chosenPairs.length)throw new Error('לא זוהה הווריאנט המסומן');
    const meta={pid,pageUrl,variant,selectedHtml,attrs};
    let found=await findResponse(window,chosenPairs,'',5);let got=found?.parsed?found:null;
    if(!got){
      const fb=found?.fallback;if(!fb)throw new Error('לא נמצאה תגובת PDP בעמוד');
      const targetSku=targetFromSku(fb.sku,chosenPairs);if(!targetSku)throw new Error('לא נמצא SKU שמתאים לווריאנט שסימנת');
      const currentSid=String(fb.sku?.selectedSkuIdStr||fb.sku?.selectedSkuId||'');
      if(currentSid===targetSku&&pathMatches(fb.sku,chosenPairs)){got={...fb,checkedCount:found.checkedCount}}
      else{
        const helper=new URL(location.href);helper.searchParams.set('sku_id',targetSku);helper.hash='';w.location=helper.toString();
        let ready=false;for(let i=0;i<24;i++){await sleep(500);try{if(w.document&&w.document.readyState!=='loading'){ready=true;break}}catch{}}
        if(!ready)throw new Error('עמוד ה-SKU המדויק לא נטען');
        await sleep(1200);
        const exact=await findResponse(w,chosenPairs,targetSku,20);if(!exact?.parsed)throw new Error('AliExpress לא החזיר משלוח עבור ה-SKU המדויק');got=exact;
      }
    }
    const data=buildData(got,meta);w.name=JSON.stringify(data);w.location=target;
  }catch(e){try{if(w&&!w.closed)w.close()}catch{}alert('לכידה נכשלה: '+String(e?.message||e))}
})();
