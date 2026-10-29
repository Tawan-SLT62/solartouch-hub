/* SOLARTOUCH Proposal: sizing calculation + editable PowerPoint (.pptx) builder.
 * Runs in the browser (window.ST_PROPOSAL) and in Node for testing (module.exports).
 * The deck is built with PptxGenJS; picture placeholders and theme colors are fixed up with JSZip
 * (bundled inside pptxgen.bundle.js) so photos can be dropped in from PowerPoint. */
(function (root) {
  'use strict';

  /* ---------- prices & assumptions (edit here) ---------- */
  const DEFAULTS = {
    tariff: 4.4,          // บาท/หน่วย
    yield: 4.5,           // หน่วย/kWp/วัน (ค่าเฉลี่ยประเทศไทย)
    dayPct: 60,           // % ใช้ไฟกลางวัน
    backupW: 420,         // โหลดในตู้ Backup (W)
    panelW: 650,          // แผง N-type
    panelPrice: 4300,
    // แบตเตอรี่ที่มีขาย: ขนาด (kWh) และราคาต่อชุด
    batteries: [{ kwh: 5, price: 55000 }, { kwh: 16.1, price: 150000 }],
    battDod: 0.9, battEff: 0.92,
    mountPerPanel: 950, protection: 9500, cables: 7500, laborPerKwp: 2500, engineering: 12000,
    hybridInvFactor: 1.35, vat: 0.07, degradation: 0.005,
    brand: 'GoodWe',      // ยี่ห้ออินเวอร์เตอร์เริ่มต้น
    dcAcMax: 1.5,         // ใส่แผงเกินขนาดอินเวอร์เตอร์ได้สูงสุดกี่เท่า (kWp ÷ kW)
    // มิเตอร์ 1 เฟส: ขนาดอินเวอร์เตอร์ที่มีขาย (kW)
    inverters1: {
      GoodWe: { ongrid: [5], hybrid: [5, 6, 10] },
      Huawei: { ongrid: [5, 10], hybrid: [5, 10] }
    },
    peakFactor: 0.7,      // พีคเฉลี่ยทั้งปี ≈ 70% ของกำลังติดตั้ง
    company: { name: 'Solar Touch Company Limited', phone: '098-246-3030', web: 'www.solartouch.co.th' }
  };
  const STD_INV = [3, 5, 6, 8, 10, 12, 15, 20, 25, 30];
  const invPrice = (kw, hyb, P) => Math.round((kw <= 3 ? 28000 : kw <= 5 ? 36000 : kw <= 10 ? 62000 : 95000) * (hyb ? P.hybridInvFactor : 1));
  // [ชื่อ, ไฮบริด, ลำดับแบตเตอรี่ใน DEFAULTS.batteries]
  const OPT_DEFS = [['On-Grid', false, -1], ['Hybrid', true, 0], ['Hybrid แบตใหญ่', true, 1]];

  /* ---------- calculation ---------- */
  // input: {phase, mode:'bill'|'units', bill, units, tariff, dayPct, maxKwp, backupW, yield, rec}
  function calc(input, over) {
    const P = Object.assign({}, DEFAULTS, over || {});
    const i = input || {};
    const T = +i.tariff > 0 ? +i.tariff : P.tariff;
    const Y = +i.yield > 0 ? +i.yield : P.yield;
    const day = Math.min(95, Math.max(5, +i.dayPct > 0 ? +i.dayPct : P.dayPct)) / 100;
    const backupW = +i.backupW > 0 ? +i.backupW : P.backupW;
    const W = P.panelW;
    const phase = String(i.phase) === '3' ? 3 : 1;
    const kwh = i.mode === 'units' ? (+i.units || 0) : (+i.bill || 0) / T;
    const bill = i.mode === 'units' ? kwh * T : (+i.bill || 0);
    const maxKwp = +i.maxKwp > 0 ? +i.maxKwp : null;
    const D = { T, Y, W, day, phase, kwh, bill, backupW, maxKwp, dD: kwh * day / 30, nD: kwh * (1 - day) / 30, opts: [], dropped: [], P };
    if (!(kwh > 0)) return Object.assign(D, { ok: false, why: 'กรอกค่าไฟหรือจำนวนหน่วยต่อเดือน' });
    const brand = P.inverters1[i.brand] ? i.brand : P.brand;
    D.brand = brand;
    // ขนาดอินเวอร์เตอร์ที่เลือกได้ และจำนวนแผงสูงสุดที่อินเวอร์เตอร์ใหญ่สุดรับได้
    const sizes = hyb => (phase === 1 ? P.inverters1[brand][hyb ? 'hybrid' : 'ongrid'] : STD_INV);
    const panCapOf = hyb => (phase === 1 ? Math.floor(Math.max(...sizes(hyb)) * P.dcAcMax * 1000 / W + 1e-9) : Infinity);
    const pickInv = (kwp, hyb) => {
      const L = sizes(hyb);
      // 1 เฟส: ใส่แผงเกินขนาดอินเวอร์เตอร์ได้ถึง dcAcMax เท่า · 3 เฟส: อินเวอร์เตอร์ ≥ 90% ของ kWp
      const ok = phase === 1 ? L.find(s => kwp <= s * P.dcAcMax + 1e-9) : L.find(s => s >= kwp * 0.9);
      return ok || L[L.length - 1];
    };

    const build = (name, hyb, bi, forcePan) => {
      const B = hyb ? P.batteries[bi] : null, bk = B ? B.kwh : 0, nb = B ? 1 : 0;
      const us = bk * P.battDod;
      const need = hyb ? (D.dD + Math.min(us, D.nD) / P.battEff) / Y : D.dD / Y;
      let pan = forcePan || Math.max(1, Math.ceil(need * 1000 / W - 1e-9));
      const capped = pan > panCapOf(hyb);
      pan = Math.min(pan, panCapOf(hyb));
      const kwp = pan * W / 1000;
      const ik = pickInv(kwp, hyb);
      const prod = kwp * Y, direct = Math.min(prod, D.dD);
      const st = hyb ? Math.min((prod - direct) * P.battEff, us, D.nD) : 0;
      const save = (direct + st) * 30 * T;
      const items = [
        { d: `แผงโซลาร์ N-type ${W}W Bi-Facial (Tier 1)`, q: pan, u: 'แผง', p: P.panelPrice },
        { d: `อินเวอร์เตอร์ ${brand} ${hyb ? 'Hybrid' : 'On-Grid'} ${ik} kW ${phase} เฟส (อยู่ในบัญชีการไฟฟ้า)`, q: 1, u: 'เครื่อง', p: invPrice(ik, hyb, P) },
        ...(B ? [{ d: `แบตเตอรี่ลิเธียม LFP ${bk} kWh`, q: 1, u: 'ชุด', p: B.price }] : []),
        { d: 'รางอะลูมิเนียมและอุปกรณ์ยึดหลังคา', q: pan, u: 'ชุด', p: P.mountPerPanel },
        { d: 'ตู้ DC/AC Protection (เบรกเกอร์ / Surge / ฟิวส์)', q: 1, u: 'ตู้', p: P.protection },
        { d: 'สาย PV1-F, สาย AC, ท่อร้อยสาย และกราวด์', q: 1, u: 'งาน', p: P.cables },
        { d: 'ค่าแรงติดตั้ง ทดสอบ และเดินระบบ', q: +kwp.toFixed(2), u: 'kWp', p: P.laborPerKwp },
        { d: 'ออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตขนานไฟ', q: 1, u: 'งาน', p: P.engineering }
      ];
      const ex = items.reduce((a, it) => a + it.q * it.p, 0), cost = ex * (1 + P.vat);
      const cum = []; let c = -cost;
      for (let y = 0; y <= 25; y++) { cum.push(Math.round(c)); c += save * 12 * Math.pow(1 - P.degradation, y); }
      return {
        name, hyb, nb, need: +need.toFixed(2), batt: bk, pan, kwp: +kwp.toFixed(2), inv: ik, brand, capped, dcac: +(kwp / ik).toFixed(2),
        prodMo: Math.round(prod * 30), prodYr: Math.round(prod * 365), save: Math.round(save), pct: Math.round(save / bill * 100),
        ex: Math.round(ex), cost: Math.round(cost), payback: save > 0 ? +(cost / (save * 12)).toFixed(1) : 0,
        night: hyb && D.nD ? Math.round(st / D.nD * 100) : 0, y25: Math.round(cum[25]),
        backupH: hyb ? +(us / (backupW / 1000)).toFixed(1) : 0, cum, items
      };
    };
    let all = OPT_DEFS.map(([n, h, b]) => build(n, h, b));
    // ตัดทางเลือกที่ต้องใช้ขนาดเกินพื้นที่ติดตั้งได้
    if (maxKwp) {
      all.forEach(o => { if (o.kwp > maxKwp + 1e-9) D.dropped.push({ name: o.name, kwp: o.kwp, why: 'เกินพื้นที่ติดตั้ง' }); });
      all = all.filter(o => o.kwp <= maxKwp + 1e-9);
      if (!all.length) { // ไม่มีทางเลือกไหนพอดี: เสนอ On-Grid ขนาดเต็มพื้นที่
        const pan = Math.max(1, Math.floor(maxKwp * 1000 / W + 1e-9));
        all = [Object.assign(build('On-Grid', false, 0, pan), { sizedToRoof: true })];
      }
    }
    // ไม่เสนอทางเลือกที่ขนาดซ้ำกัน (เช่น ถูกจำกัดด้วยมิเตอร์ 1 เฟส)
    const seen = new Set();
    all = all.filter(o => { const k = o.hyb + '|' + o.pan + '|' + o.batt; if (seen.has(k)) return false; seen.add(k); return true; });
    D.opts = all;
    D.capped = all.filter(o => o.capped).map(o => ({ name: o.name, inv: o.inv, kwp: o.kwp }));
    const recName = i.rec && all.find(o => o.name === i.rec) ? i.rec : all[0].name;
    D.rec = all.find(o => o.name === recName);
    // hourly load and production profiles (06:00–18:00 sun)
    const dw = []; for (let h = 6; h < 18; h++) dw.push(1 + 0.3 * Math.sin((h - 6) / 12 * Math.PI));
    const nh = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5], nw = nh.map(h => (h >= 18 && h < 23 ? 1.6 : 0.7));
    const sdw = dw.reduce((a, b) => a + b, 0), snw = nw.reduce((a, b) => a + b, 0);
    D.load = Array.from({ length: 24 }, (_, h) => +(h >= 6 && h < 18 ? D.dD * dw[h - 6] / sdw : D.nD * nw[nh.indexOf(h)] / snw).toFixed(2));
    const sol = Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 18 ? Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) : 0)), ss = sol.reduce((a, b) => a + b, 0);
    D.opts.forEach(o => { o.prof = sol.map(s => +(o.prodMo / 30 * s / ss).toFixed(2)); });
    D.ok = true;
    return D;
  }

  /* ---------- deck ---------- */
  const THEME = {
    name: 'SOLAR TOUCH',
    colors: { dk1: '0D1A33', lt1: 'FFFFFF', dk2: '0A2350', lt2: 'F2F5FB', accent1: 'F0661A', accent2: '1E4FD6', accent3: '11905A', accent4: 'FFB01F', accent5: '7783A0', accent6: 'C42F2A', hlink: '1E4FD6', folHlink: '46546F' }
  };
  const HEX = { navy: '0A2350', orange: 'F0661A', blue: '1E4FD6', green: '11905A', sun: 'FFB01F', grey: '7783A0', red: 'C42F2A', ink: '0D1A33', ink2: '46546F', orangeSoft: 'FFE9DA', greenSoft: 'DCF4E8', redSoft: 'FCE2E1', blueSoft: 'E2EAFF' };
  const PIC_PROMPT = 'คลิกไอคอนเพื่อใส่รูป';
  const fmt = n => Math.round(+n || 0).toLocaleString('en-US');
  const fmt1 = n => (Math.round((+n || 0) * 10) / 10).toLocaleString('en-US');
  const fk = n => String(+(+n).toFixed(2));

  // meta: {customer, addr, date, terms:[{pct,label,when}], proposer:{name, phone, email}}
  function buildDeck(PptxGenJS, D, meta, assets) {
    const I = assets.icons, logo = assets.logo;
    const OPTS = D.opts;
    const HYB = OPTS.find(o => o.hyb);
    const customer = meta.customer || 'ลูกค้า';
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    pres.title = 'Solar Proposal – ' + customer;
    pres.author = 'SOLAR TOUCH';
    pres.company = 'Solar Touch Company Limited';
    pres.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' };
    const C = pres.SchemeColor;
    const co = D.P.company;

    // ---------- layouts ----------
    pres.defineSlideMaster({
      title: 'ST Cover', background: { color: C.text2 },
      objects: [
        { rect: { x: 0.5, y: 0.45, w: 2.9, h: 0.95, fill: { color: C.background1 }, rectRadius: 0.1 } },
        { image: { data: logo, x: 0.65, y: 0.55, w: 2.6, h: 0.75 } },
        { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 1.85, w: 6.4, h: 1.0, fontSize: 40, bold: true, color: C.background1, valign: 'top', align: 'left', margin: 0 }, text: 'Solar Proposal' } },
        { placeholder: { options: { name: 'body', type: 'body', x: 0.5, y: 2.9, w: 6.4, h: 1.5, fontSize: 16, color: 'BFCDEE', valign: 'top', align: 'left', margin: 0 }, text: 'ลูกค้า' } },
        { text: { text: `${co.name}  ·  ${co.phone}  ·  ${co.web}`, options: { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: 10, color: 'BFCDEE', margin: 0 } } }
      ]
    });
    const pageNo = { x: 9.0, y: 5.22, w: 0.5, h: 0.25, fontSize: 9, color: '7783A0', align: 'right' };
    const contentObjs = () => [
      { image: { data: logo, x: 8.0, y: 0.28, w: 1.5, h: 0.43 } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.25, w: 7.3, h: 0.6, fontSize: 26, bold: true, color: C.text2, valign: 'middle', align: 'left', margin: 0 }, text: 'หัวข้อ' } },
      { text: { text: 'SOLAR TOUCH  ·  Solar Proposal  ·  ' + customer, options: { x: 0.5, y: 5.22, w: 7, h: 0.25, fontSize: 9, color: C.accent5, margin: 0 } } }
    ];
    pres.defineSlideMaster({ title: 'ST Content', background: { color: C.background1 }, margin: [0.5, 0.5, 0.55, 0.5], objects: contentObjs(), slideNumber: pageNo });
    pres.defineSlideMaster({
      title: 'ST Closing', background: { color: C.text2 },
      objects: [
        { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 26, bold: true, color: C.background1, align: 'left', margin: 0 }, text: 'หัวข้อ' } },
        { text: { text: 'SOLAR TOUCH  ·  Solar Proposal', options: { x: 0.5, y: 5.22, w: 7, h: 0.25, fontSize: 9, color: 'BFCDEE', margin: 0 } } }
      ],
      slideNumber: Object.assign({}, pageNo, { color: 'BFCDEE' })
    });
    // photo-slot layouts: dashed frame + label on the layout, real picture placeholder on top
    const slot = (k, x, y, w, h, label) => [
      { rect: { x, y, w, h, fill: { color: C.background2 }, line: { color: 'B8C3D9', width: 1, dashType: 'dash' } } },
      { image: { data: I.cam, x: x + w / 2 - 0.2, y: y + h / 2 - 0.38, w: 0.4, h: 0.4 } },
      { text: { text: label, options: { x, y: y + h / 2 + 0.06, w, h: 0.3, fontSize: 10, color: C.accent5, align: 'center', margin: 0 } } },
      { placeholder: { options: { name: 'photo' + k, type: 'image', x, y, w, h }, text: PIC_PROMPT } }
    ];
    const capPh = (k, x, y, w, h) => ({ placeholder: { options: { name: 'cap' + k, type: 'body', x, y, w, h, fontSize: 11, color: C.text1, align: 'center', valign: 'top', margin: 0 }, text: 'คำบรรยายรูป' } });
    pres.defineSlideMaster({ title: 'ST Roof Photo', background: { color: C.background1 }, slideNumber: pageNo,
      objects: [...contentObjs(), ...slot(1, 0.5, 1.05, 4.3, 3.95, 'ใส่ภาพหลังคาจากดาวเทียม หรือแบบวางแผง')] });
    pres.defineSlideMaster({ title: 'ST Equipment Photos', background: { color: C.background1 }, slideNumber: pageNo,
      objects: [...contentObjs(), ...[0, 1, 2, 3].flatMap(i => [...slot(i + 1, 0.5 + i * 2.3, 1.05, 2.1, 2.55, 'ใส่รูปอุปกรณ์จริง'), capPh(i + 1, 0.5 + i * 2.3, 3.72, 2.1, 1.25)])] });
    pres.defineSlideMaster({ title: 'ST Portfolio', background: { color: C.background1 }, slideNumber: pageNo,
      objects: [...contentObjs(), ...[0, 1, 2, 3, 4, 5].flatMap(i => {
        const x = 0.5 + (i % 3) * 3.05, y = 1.0 + Math.floor(i / 3) * 2.05;
        return [...slot(i + 1, x, y, 2.9, 1.6, 'ใส่รูปผลงาน'), capPh(i + 1, x, y + 1.64, 2.9, 0.3)];
      })] });

    const card = (s, x, y, w, h, fill, name) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill || C.background2 }, line: { type: 'none' }, objectName: name });
    const circleIcon = (s, data, x, y, d, fill, name) => {
      s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: name + ' circle' });
      s.addImage({ data, x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, objectName: name + ' icon' });
    };
    const OCOL = [HEX.orange, HEX.blue, HEX.green];
    const chartText = { catAxisLabelColor: HEX.grey, valAxisLabelColor: HEX.grey, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', valGridLine: { color: 'E6EBF4', size: 0.75 }, catGridLine: { style: 'none' }, showLegend: true, legendPos: 'b', legendFontSize: 10, legendFontFace: '+mn-lt', legendColor: HEX.ink2 };
    const ct = o => Object.assign({}, chartText, { valGridLine: { color: 'E6EBF4', size: 0.75 }, catGridLine: { style: 'none' } }, o);

    // ---------- cover ----------
    pres.addSection({ title: 'ปก' });
    {
      const s = pres.addSlide({ masterName: 'ST Cover', sectionTitle: 'ปก' });
      s.addText('Solar Proposal', { placeholder: 'title' });
      s.addText([
        { text: customer, options: { fontSize: 24, bold: true, color: 'FFFFFF', breakLine: true } },
        ...(meta.addr ? [{ text: meta.addr, options: { breakLine: true } }] : []),
        { text: 'ข้อเสนอระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์  ·  ' + meta.date }
      ], { placeholder: 'body' });
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.05, y: 1.85, w: 2.45, h: 1.0 + 0.42 * (OPTS.length + 1), rectRadius: 0.1, fill: { color: C.accent1 }, line: { type: 'none' }, objectName: 'Options panel' });
      s.addImage({ data: I.panelW, x: 7.3, y: 2.05, w: 0.5, h: 0.5, objectName: 'Panel icon' });
      s.addText([
        { text: 'ทางเลือกในข้อเสนอนี้', options: { fontSize: 12, color: 'FFFFFF', breakLine: true, paraSpaceAfter: 4 } },
        ...OPTS.map((o, k) => ({ text: `${o.name} ${fk(o.kwp)} kWp`, options: { fontSize: OPTS.length > 2 ? 14 : 16, bold: true, color: 'FFFFFF', breakLine: k < OPTS.length - 1 } }))
      ], { x: 7.3, y: 2.65, w: 2.05, h: 1.8, valign: 'top', margin: 0, isTextBox: true, objectName: 'Options text' });
    }

    // ---------- current usage ----------
    pres.addSection({ title: 'การใช้ไฟของลูกค้า' });
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'การใช้ไฟของลูกค้า' });
      s.addText('การใช้ไฟปัจจุบัน', { placeholder: 'title' });
      [['ค่าไฟต่อเดือน', '฿' + fmt(D.bill), ''], ['ใช้ไฟต่อเดือน', fmt(D.kwh), 'หน่วย'], ['มิเตอร์', D.phase + ' เฟส', ''], ['ค่าไฟเฉลี่ย', fmt1(D.T), 'บาท/หน่วย']].forEach(([l, v, u], i) => {
        const x = 0.5 + (i % 2) * 2.3, y = 1.15 + Math.floor(i / 2) * 1.35;
        card(s, x, y, 2.1, 1.15, C.background2, 'Stat ' + l);
        s.addText(l, { x: x + 0.2, y: y + 0.15, w: 1.8, h: 0.3, fontSize: 11, color: C.accent5, margin: 0, isTextBox: true });
        s.addText([{ text: v, options: { fontSize: 26, bold: true, color: C.text1 } }, { text: u ? ' ' + u : '', options: { fontSize: 11, color: C.accent5 } }], { x: x + 0.2, y: y + 0.5, w: 1.85, h: 0.5, margin: 0, isTextBox: true });
      });
      const dp = Math.round(D.day * 100);
      s.addChart(pres.charts.DOUGHNUT, [{ name: 'การใช้ไฟ', labels: ['กลางวัน', 'กลางคืน'], values: [dp, 100 - dp] }], {
        x: 5.35, y: 1.0, w: 2.4, h: 2.6, holeSize: 62, chartColors: [HEX.sun, HEX.navy], showLegend: false, showPercent: false, showValue: false, showTitle: false, objectName: 'Day night split'
      });
      s.addText([{ text: dp + '%', options: { fontSize: 24, bold: true, color: C.text1, breakLine: true } }, { text: 'กลางวัน', options: { fontSize: 11, color: C.accent5 } }], { x: 5.95, y: 1.95, w: 1.2, h: 0.75, align: 'center', margin: 0, isTextBox: true });
      [[I.sun, 'กลางวัน 06:00–18:00', `${fmt1(D.dD)} หน่วย/วัน`], [I.moon, 'กลางคืน 18:00–06:00', `${fmt1(D.nD)} หน่วย/คืน`]].forEach(([ic, t, v], i) => {
        const y = 1.25 + i * 1.05;
        s.addImage({ data: ic, x: 7.95, y, w: 0.42, h: 0.42, objectName: t + ' icon' });
        s.addText([{ text: t, options: { fontSize: 11, color: C.accent5, breakLine: true } }, { text: v, options: { fontSize: 15, bold: true, color: C.text1 } }], { x: 8.45, y: y - 0.05, w: 1.5, h: 0.65, margin: 0, isTextBox: true });
      });
      card(s, 0.5, 3.95, 9.0, 1.05, C.background2, 'Design note');
      s.addText([
        { text: 'หลักการออกแบบ  ', options: { bold: true, color: C.text2 } },
        { text: `ระบบออนกริดออกแบบให้พอดีกับไฟที่ใช้กลางวัน (${fmt1(D.dD)} หน่วย/วัน) ส่วนระบบไฮบริดเพิ่มแผงและแบตเตอรี่ เพื่อเก็บไฟไว้ใช้กลางคืน (${fmt1(D.nD)} หน่วย/คืน) คำนวณที่ ${fmt1(D.Y)} หน่วย/kWp/วัน`, options: { color: C.text1 } }
      ], { x: 0.75, y: 4.05, w: 8.5, h: 0.85, fontSize: 13, valign: 'middle', margin: 0, isTextBox: true });
    }

    // ---------- daily load vs production ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'การใช้ไฟของลูกค้า' });
      s.addText('การใช้ไฟเทียบการผลิตไฟต่อวัน', { placeholder: 'title' });
      const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
      s.addChart(pres.charts.LINE, [{ name: 'การใช้ไฟของบ้าน', labels: hours, values: D.load }, ...OPTS.map(o => ({ name: `ผลิตไฟ ${o.name} ${fk(o.kwp)} kWp`, labels: hours, values: o.prof }))], ct({
        x: 0.4, y: 1.0, w: 9.2, h: 4.1, chartColors: [HEX.navy, ...OCOL.slice(0, OPTS.length)], lineSize: 2.5, lineDataSymbol: 'none', catAxisLabelFrequency: 2,
        showValAxisTitle: true, valAxisTitle: 'kW', valAxisTitleFontSize: 10, valAxisTitleColor: HEX.grey, valAxisTitleFontFace: '+mn-lt',
        showTitle: true, title: 'การใช้ไฟและการผลิตไฟเฉลี่ยรายชั่วโมง (kW)', titleFontSize: 12, titleColor: HEX.ink, titleFontFace: '+mn-lt', objectName: 'Daily load vs solar'
      }));
      s.addNotes(`เส้นน้ำเงินเข้มคือการใช้ไฟของบ้าน เส้นอื่นคือกำลังผลิตเฉลี่ยของแต่ละทางเลือก (kW) ช่วงที่เส้นผลิตไฟซ้อนกับเส้นการใช้ไฟคือไฟที่ช่วยลดค่าไฟ คิดที่ ${fmt1(D.Y)} หน่วย/kWp/วัน`);
    }

    // ---------- how systems work ----------
    pres.addSection({ title: 'ระบบโซลาร์' });
    const flow = (s, x0, y0, hyb, outage, tag, backup) => {
      const d = 0.62, gap = 0.35;
      const nodes = [['แผงโซลาร์', I.panel, x0, y0], ['อินเวอร์เตอร์', I.inv, x0 + d + gap + 0.15, y0], [outage && backup ? 'ตู้ Backup' : 'บ้าน', I.home, x0 + 2 * (d + gap) + 0.3, y0],
        [outage ? 'การไฟฟ้า (ดับ)' : 'การไฟฟ้า', outage ? I.gridRed : I.grid, x0 + 2 * (d + gap) + 0.3, y0 + 1.05]];
      if (hyb) nodes.push(['แบตเตอรี่', I.batt, x0 + d + gap + 0.15, y0 + 1.05]);
      const dim = outage && !backup;
      nodes.forEach(([t, ic, x, y], k) => {
        const off = dim && k !== 3;
        s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.background1 }, line: { color: off ? 'D9E1EF' : (k === 3 && outage ? HEX.red : 'D9E1EF'), width: 1.5 }, objectName: `${tag} ${t} circle` });
        s.addImage({ data: ic, x: x + 0.14, y: y + 0.14, w: d - 0.28, h: d - 0.28, transparency: off ? 65 : 0, objectName: `${tag} ${t} icon` });
        s.addText(t, { x: x - 0.3, y: y + d + 0.02, w: d + 0.6, h: 0.25, fontSize: 9, align: 'center', color: off ? 'A9B3C7' : C.text1, margin: 0, isTextBox: true });
      });
      const arrow = (x1, y1, x2, y2, col, dash) => s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001, flipH: x2 < x1, flipV: y2 < y1, line: { color: col, width: 2, endArrowType: 'triangle', dashType: dash ? 'dash' : 'solid' }, objectName: `${tag} arrow` });
      const n = nodes;
      arrow(n[0][2] + d, y0 + d / 2, n[1][2], y0 + d / 2, dim ? 'D9E1EF' : HEX.orange, dim);
      arrow(n[1][2] + d, y0 + d / 2, n[2][2], y0 + d / 2, dim ? 'D9E1EF' : HEX.navy, dim);
      if (!outage) arrow(n[3][2] + d / 2, n[3][3], n[2][2] + d / 2, y0 + d + 0.26, HEX.grey, false);
      if (hyb) {
        arrow(n[1][2] + d / 2 - 0.08, y0 + d + 0.26, n[1][2] + d / 2 - 0.08, n[4][3], dim ? 'D9E1EF' : HEX.green, dim);
        arrow(n[1][2] + d / 2 + 0.08, n[4][3], n[1][2] + d / 2 + 0.08, y0 + d + 0.26, dim ? 'D9E1EF' : HEX.green, dim);
      }
    };
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ระบบโซลาร์' });
      s.addText('ระบบโซลาร์ทำงานอย่างไร', { placeholder: 'title' });
      [[false, 'ระบบออนกริด (On-Grid)', 'ต่อร่วมกับไฟจากการไฟฟ้า กลางวันแผงโซลาร์ผลิตไฟให้บ้านใช้ก่อน ถ้าไม่พอ ดึงไฟจากการไฟฟ้ามาเสริมเองอัตโนมัติ กลางคืนใช้ไฟจากการไฟฟ้าตามปกติ',
        [['ราคาประหยัด คืนทุนเร็ว', true], ['ไม่มีแบตเตอรี่ ดูแลรักษาน้อย', true], ['ลดค่าไฟเฉพาะช่วงกลางวัน', false]]],
       [true, 'ระบบไฮบริด (Hybrid)', 'ระบบออนกริดที่เพิ่มแบตเตอรี่ กลางวันผลิตไฟให้บ้านใช้และเก็บส่วนที่เหลือเข้าแบตเตอรี่ กลางคืนดึงไฟจากแบตเตอรี่มาใช้ก่อน แล้วจึงใช้ไฟจากการไฟฟ้า',
        [['ลดค่าไฟได้ทั้งกลางวันและกลางคืน', true], ['เพิ่มระบบ Backup ให้มีไฟใช้ตอนไฟดับได้', true], ['ราคาสูงกว่า คืนทุนช้ากว่า', false]]]
      ].forEach(([hyb, t, desc, pts], i) => {
        const x = 0.5 + i * 4.6;
        card(s, x, 1.05, 4.4, 4.0, C.background2, t + ' card');
        s.addText(t, { x: x + 0.25, y: 1.15, w: 3.9, h: 0.4, fontSize: 16, bold: true, color: C.text2, margin: 0, isTextBox: true });
        flow(s, x + 0.55, 1.65, hyb, false, t);
        s.addText(desc, { x: x + 0.25, y: 3.68, w: 3.9, h: 0.75, fontSize: 10.5, color: C.text1, valign: 'top', margin: 0, isTextBox: true });
        s.addText(pts.map(([p, ok], k) => ({ text: (ok ? '✓  ' : '!  ') + p, options: { color: ok ? HEX.green : 'A86400', breakLine: k < pts.length - 1 } })), { x: x + 0.25, y: 4.42, w: 3.9, h: 0.6, fontSize: 10.5, bold: true, valign: 'top', margin: 0, isTextBox: true });
      });
    }

    // ---------- outage ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ระบบโซลาร์' });
      s.addText('ถ้าไฟจากการไฟฟ้าดับ ใช้ไฟจากโซลาร์ได้ไหม', { placeholder: 'title' });
      const bk = HYB ? ` ใช้ได้ประมาณ ${fmt1(HYB.backupH)} ชั่วโมงจากแบต ${fmt1(HYB.batt)} kWh` : '';
      [[false, 'ออนกริดและไฮบริด: หยุดทำงาน', HEX.red, I.cross, 'เมื่อไฟจากการไฟฟ้าดับ อินเวอร์เตอร์ทั้งระบบออนกริดและไฮบริดจะหยุดจ่ายไฟทันที แม้มีแดดหรือมีไฟในแบตเตอรี่ เพื่อป้องกันไฟไหลย้อนกลับเข้าสายไฟของการไฟฟ้า ซึ่งอาจทำให้เจ้าหน้าที่ (โอเปอเรเตอร์) ที่กำลังซ่อมสายถูกไฟช็อต'],
       [true, 'ต้องการใช้ไฟ: ทำระบบ Backup', HEX.green, I.check, `ทำระบบ Backup เพิ่มเติม (ตู้ Backup + อินเวอร์เตอร์ไฮบริดและแบตเตอรี่) ระบบจะตัดออกจากสายการไฟฟ้าก่อน แล้วจ่ายไฟจากโซลาร์และแบตเตอรี่ให้เฉพาะวงจรสำคัญในตู้ Backup อัตโนมัติ เช่น ตู้เย็น ไฟ Wi-Fi ปั๊มน้ำ (${fmt(D.backupW)} W)${bk}`]
      ].forEach(([backup, t, col, ic, txt], i) => {
        const x = 0.5 + i * 4.6;
        card(s, x, 1.05, 4.4, 4.0, i ? HEX.greenSoft : HEX.redSoft, t + ' card');
        circleIcon(s, ic, x + 0.25, 1.2, 0.55, col, t);
        s.addText(t, { x: x + 0.95, y: 1.27, w: 3.3, h: 0.42, fontSize: 16, bold: true, color: col, margin: 0, isTextBox: true });
        flow(s, x + 0.55, 1.95, true, true, t + ' outage', backup);
        s.addText(txt, { x: x + 0.25, y: 3.95, w: 3.95, h: 1.05, fontSize: 10.5, color: C.text1, valign: 'top', margin: 0, isTextBox: true });
      });
      s.addNotes('ไฟดับแล้วทั้งออนกริดและไฮบริดหยุดทำงานเพื่อความปลอดภัยของเจ้าหน้าที่การไฟฟ้า (Anti-Islanding) ถ้าต้องการใช้ไฟตอนไฟดับ ต้องทำระบบ Backup เพิ่ม');
    }

    // ---------- production curve ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ระบบโซลาร์' });
      s.addText('Solar Production Curve (10 kWp)', { placeholder: 'title' });
      const ts = Array.from({ length: 25 }, (_, i) => 6 + i * 0.5);
      const lab = ts.map(t => (t % 1 ? '' : String(t).padStart(2, '0') + ':00'));
      const peak = 10 * D.P.peakFactor;
      const prod = ts.map(t => Math.round(peak * Math.pow(Math.max(0, Math.sin(Math.PI * (t - 6) / 12)), 1.7) * 100) / 100);
      s.addChart([
        { type: pres.charts.AREA, data: [{ name: 'กำลังผลิตเฉลี่ยทั้งปี (kW)', labels: lab, values: prod }], options: { chartColors: [HEX.sun], chartColorsOpacity: 70 } },
        { type: pres.charts.LINE, data: [{ name: 'กำลังติดตั้ง 10 kWp', labels: lab, values: ts.map(() => 10) }, { name: `พีคเฉลี่ยทั้งปี ~${fmt1(peak)} kW`, labels: lab, values: ts.map(() => peak) }],
          options: { chartColors: [HEX.navy, HEX.orange], lineSize: 2, lineDataSymbol: 'none', lineDash: 'dash' } }
      ], ct({
        x: 0.4, y: 1.0, w: 5.9, h: 4.05, valAxisMaxVal: 12, valAxisMinVal: 0, valAxisMajorUnit: 2,
        showValAxisTitle: true, valAxisTitle: 'กำลังผลิต (kW)', valAxisTitleFontSize: 9, valAxisTitleColor: HEX.grey, valAxisTitleFontFace: '+mn-lt',
        showTitle: true, title: 'ระบบ 10 kWp: กำลังผลิตเฉลี่ยตลอดวัน', titleFontSize: 12, titleColor: HEX.ink, titleFontFace: '+mn-lt', objectName: 'Solar production curve 10 kWp'
      }));
      card(s, 6.55, 1.0, 2.95, 4.05, C.background2, 'Why 7 kW');
      const b = t => ({ text: t, options: { bullet: { indent: 12 }, fontSize: 10.5, color: C.text1, breakLine: true } });
      const last = b('การสูญเสียในสายไฟและอินเวอร์เตอร์'); last.options.breakLine = false;
      s.addText([
        { text: `ทำไมติด 10 kWp ได้พีคราว ${fmt1(peak)} kW`, options: { bold: true, fontSize: 13, color: C.text2, breakLine: true } },
        { text: '10 kWp คือกำลังของแผงในห้องทดสอบ ใช้งานจริงกำลังลดลงเพราะ', options: { fontSize: 10.5, color: C.text1, breakLine: true, paraSpaceAfter: 4 } },
        b('ความร้อนของแผง'), b('มุมและทิศของหลังคา'), b('ฝุ่น เมฆ และฤดูกาล'), last
      ], { x: 6.75, y: 1.12, w: 2.6, h: 2.0, valign: 'top', margin: 0, isTextBox: true, objectName: 'Why peak text' });
      OPTS.forEach((o, i) => {
        s.addText([{ text: `ระบบ ${o.name} ${fk(o.kwp)} kWp`, options: { fontSize: 10, color: C.accent5, breakLine: true } }, { text: `พีคเฉลี่ย ~${fmt1(o.kwp * D.P.peakFactor)} kW`, options: { fontSize: 14, bold: true, color: OCOL[i] } }],
          { x: 6.75, y: 3.2 + i * 0.6, w: 2.6, h: 0.55, margin: 0, isTextBox: true });
      });
    }

    // ---------- installation area ----------
    pres.addSection({ title: 'ข้อเสนอ' });
    {
      const s = pres.addSlide({ masterName: 'ST Roof Photo', sectionTitle: 'ข้อเสนอ' });
      s.addText('พื้นที่ติดตั้ง', { placeholder: 'title' });
      s.addText('', { placeholder: 'photo1', objectName: 'Photo slot roof' });
      card(s, 5.1, 1.05, 4.4, 1.55, HEX.blueSoft, 'Max capacity');
      s.addText([
        { text: 'พื้นที่หลังคาติดตั้งได้ประมาณ', options: { fontSize: 13, color: HEX.blue, breakLine: true } },
        { text: D.maxKwp ? `${fk(D.maxKwp)} kWp` : '– kWp', options: { fontSize: 36, bold: true, color: HEX.blue, breakLine: true } },
        { text: 'ประเมินจากการสำรวจหน้างานและภาพถ่ายดาวเทียม', options: { fontSize: 10, color: C.accent5 } }
      ], { x: 5.3, y: 1.12, w: 4.05, h: 1.42, valign: 'middle', margin: 0, isTextBox: true, objectName: 'Max capacity text' });
      s.addText('ทางเลือกที่ติดตั้งได้', { x: 5.1, y: 2.85, w: 4.4, h: 0.35, fontSize: 14, bold: true, color: C.text2, margin: 0, isTextBox: true });
      OPTS.forEach((o, i) => {
        const y = 3.3 + i * 0.55;
        circleIcon(s, I.check, 5.1, y + 0.04, 0.36, HEX.green, o.name + ' fits');
        s.addText([{ text: `${o.name} ${fk(o.kwp)} kWp`, options: { bold: true, color: C.text1 } }, { text: `   ${o.pan} แผง${o.hyb ? ` · แบต ${fmt1(o.batt)} kWh` : ''}`, options: { color: C.accent5, fontSize: 11 } }],
          { x: 5.6, y, w: 3.9, h: 0.44, fontSize: 13, valign: 'middle', margin: 0, isTextBox: true });
      });
      s.addNotes('ใส่ภาพหลังคาจากดาวเทียมหรือแบบวางแผงในกรอบด้านซ้าย');
    }

    // ---------- comparison ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ข้อเสนอ' });
      s.addText('เปรียบเทียบทางเลือก', { placeholder: 'title' });
      const head = (t, sub, col) => ({ text: [{ text: t, options: { bold: true, breakLine: true } }, { text: sub, options: { fontSize: 9 } }], options: { color: 'FFFFFF', fill: { color: col }, align: 'center', valign: 'middle' } });
      const row = (label, f, bold) => [{ text: label, options: { bold: true, color: HEX.ink2 } }, ...OPTS.map(o => ({ text: f(o), options: { align: 'center', bold: !!bold, fill: { color: 'FFFFFF' } } }))];
      s.addTable([
        [{ text: '', options: { fill: { color: 'FFFFFF' } } }, ...OPTS.map(o => head(o.name, o.hyb ? `แบต ${fmt1(o.batt)} kWh` : 'ไม่มีแบตเตอรี่', o.hyb ? HEX.navy : HEX.orange))],
        row('อินเวอร์เตอร์', o => `${D.brand} ${o.hyb ? 'Hybrid' : 'On-Grid'} ${o.inv} kW ${D.phase} เฟส`),
        row(`แผงโซลาร์ ${D.W}W`, o => `${o.pan} แผง · ${fk(o.kwp)} kWp`),
        row('แบตเตอรี่', o => (o.hyb ? `${fmt1(o.batt)} kWh` : '–')),
        row('ผลิตไฟ/เดือน', o => `${fmt(o.prodMo)} หน่วย`),
        row('ใช้ไฟได้ตอนไฟดับ', o => (o.hyb ? `เพิ่ม Backup ได้ ~${fmt1(o.backupH)} ชม.*` : 'ไม่ได้')),
        row('ประหยัด/เดือน', o => `฿${fmt(o.save)} (${o.pct}%)`, true),
        row('ราคารวม VAT', o => `฿${fmt(o.cost)}`, true),
        row('คืนทุน', o => `${fmt1(o.payback)} ปี`, true)
      ], { x: 0.5, y: 1.0, w: 9.0, colW: [2.1, ...OPTS.map(() => 6.9 / OPTS.length)], fontSize: 12, color: HEX.ink, border: { type: 'solid', pt: 0.5, color: 'D9E1EF' }, rowH: [0.5, 0.34, 0.34, 0.34, 0.34, 0.34, 0.34, 0.34, 0.34], objectName: 'Options comparison table' });
      s.addText(`* วงจรสำรอง ${fmt(D.backupW)} W (ตู้เย็น ไฟ Wi-Fi ปั๊มน้ำ) · ทุกระบบหยุดทำงานเมื่อไฟดับ ต้องทำระบบ Backup เพิ่ม (ยังไม่รวมในราคา)`,
        { x: 0.5, y: 4.55, w: 9.0, h: 0.5, fontSize: 10, color: C.accent5, margin: 0, isTextBox: true });
      s.addNotes('ตัวเลขคำนวณจากโปรแกรม SOLARTOUCH ราคาเป็นราคามาตรฐาน แก้ได้ก่อนส่งลูกค้า');
    }

    // ---------- 25-year value ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ข้อเสนอ' });
      s.addText('ความคุ้มค่าตลอด 25 ปี', { placeholder: 'title' });
      const yrs = Array.from({ length: 26 }, (_, i) => String(i));
      s.addChart(pres.charts.LINE, OPTS.map(o => ({ name: `${o.name} ${fk(o.kwp)} kWp`, labels: yrs, values: o.cum.map(v => Math.round(v / 1000)) })), ct({
        x: 0.4, y: 1.0, w: 6.3, h: 4.05, chartColors: OCOL.slice(0, OPTS.length), lineSize: 2.5, lineDataSymbol: 'none', catAxisLabelFrequency: 5,
        showCatAxisTitle: true, catAxisTitle: 'ปีที่', catAxisTitleFontSize: 9, catAxisTitleColor: HEX.grey, catAxisTitleFontFace: '+mn-lt', valAxisLabelFormatCode: '#,##0',
        showValAxisTitle: true, valAxisTitle: 'เงินสะสม (พันบาท)', valAxisTitleFontSize: 9, valAxisTitleColor: HEX.grey, valAxisTitleFontFace: '+mn-lt',
        showTitle: true, title: 'เงินที่ประหยัดสะสม หักค่าระบบแล้ว', titleFontSize: 12, titleColor: HEX.ink, titleFontFace: '+mn-lt', objectName: 'Cumulative savings chart'
      }));
      const SOFT = [HEX.orangeSoft, HEX.blueSoft, HEX.greenSoft];
      const n = Math.min(OPTS.length, 3), ch = n === 3 ? 1.25 : 1.8;
      OPTS.slice(0, 3).forEach((o, i) => {
        const y = 1.05 + i * (ch + 0.15);
        card(s, 6.95, y, 2.55, ch, SOFT[i], o.name + ' value card');
        s.addText([
          { text: `${o.name} ${fk(o.kwp)} kWp`, options: { fontSize: 12, bold: true, color: OCOL[i], breakLine: true } },
          { text: `คืนทุน ${fmt1(o.payback)} ปี`, options: { fontSize: n === 3 ? 16 : 20, bold: true, color: C.text1, breakLine: true } },
          { text: 'ประหยัดสุทธิ 25 ปี  ', options: { fontSize: 10, color: C.accent5, breakLine: n !== 3 } },
          { text: `฿${fmt(o.y25)}`, options: { fontSize: n === 3 ? 12 : 16, bold: true, color: C.text1 } }
        ], { x: 7.15, y: y + 0.1, w: 2.2, h: ch - 0.2, valign: 'top', margin: 0, isTextBox: true });
      });
      s.addNotes(`ประมาณการจากค่าไฟ ${D.T} บาท/หน่วย ผลิตไฟ ${D.Y} หน่วย/kWp/วัน แผงเสื่อม ${D.P.degradation * 100}%/ปี ไม่รวมการขายไฟคืน`);
    }

    // ---------- equipment & warranty ----------
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'ข้อเสนอ' });
      s.addText('อุปกรณ์และการรับประกัน', { placeholder: 'title' });
      [[I.panelW, HEX.orange, `แผงโซลาร์ N-type ${D.W}W Bi-Facial`, 'Jinko / Trina · Tier 1 BloombergNEF · รับประกันสินค้า 12 ปี · ประสิทธิภาพ 30 ปี'],
       [I.invW, HEX.navy, `อินเวอร์เตอร์ ${D.brand}`, 'อยู่ในบัญชีที่การไฟฟ้ารับรอง · รับประกัน 10 ปี'],
       ...(HYB ? [[I.battW, HEX.green, 'แบตเตอรี่ลิเธียม LFP (ไฮบริด)', 'รับประกัน 10 ปี · เพิ่มความจุภายหลังได้']] : []),
       [I.tools, HEX.blue, 'ระบบยึดและสายไฟ', 'Mounting Antai · สาย DC KUKA มาตรฐาน IEC · Combiner Box'],
       [I.sign, HEX.grey, 'ใบอนุญาตครบ', 'ออกแบบ วิศวกรรับรอง ขออนุญาตท้องถิ่น แจ้ง กกพ. และยื่นขนานไฟกับการไฟฟ้า']
      ].forEach(([ic, col, t, d], i) => {
        const y = 1.05 + i * 0.8;
        circleIcon(s, ic, 0.5, y, 0.58, col, t);
        s.addText([{ text: t, options: { fontSize: 14, bold: true, color: C.text1, breakLine: true } }, { text: d, options: { fontSize: 11, color: C.accent5 } }], { x: 1.3, y: y - 0.04, w: 8.2, h: 0.68, valign: 'middle', margin: 0, isTextBox: true });
      });
    }

    // ---------- equipment photos ----------
    {
      const s = pres.addSlide({ masterName: 'ST Equipment Photos', sectionTitle: 'ข้อเสนอ' });
      s.addText('อุปกรณ์ที่ใช้ติดตั้ง', { placeholder: 'title' });
      [['แผงโซลาร์', `Jinko N-type ${D.W}W Bi-Facial`], ['อินเวอร์เตอร์', D.brand], ['แบตเตอรี่ (ไฮบริด)', 'LFP · รับประกัน 10 ปี'], ['ระบบยึดและสายไฟ', 'Antai · KUKA DC Cable']].forEach(([t, d], i) => {
        s.addText('', { placeholder: 'photo' + (i + 1), objectName: 'Photo slot equipment ' + (i + 1) });
        s.addText([{ text: t, options: { bold: true, fontSize: 13, color: C.text2, breakLine: true } }, { text: d, options: { fontSize: 11, color: C.accent5 } }], { placeholder: 'cap' + (i + 1) });
      });
      s.addNotes('คลิกไอคอนรูปในแต่ละกรอบเพื่อใส่รูปอุปกรณ์จริง รูปจะถูกครอปให้พอดีกรอบอัตโนมัติ');
    }

    // ---------- portfolio ----------
    pres.addSection({ title: 'เกี่ยวกับเรา' });
    {
      const s = pres.addSlide({ masterName: 'ST Portfolio', sectionTitle: 'เกี่ยวกับเรา' });
      s.addText('ผลงานที่ผ่านมา', { placeholder: 'title' });
      for (let i = 1; i <= 6; i++) {
        s.addText('', { placeholder: 'photo' + i, objectName: 'Photo slot portfolio ' + i });
        s.addText([{ text: 'ชื่อผลงาน', options: { bold: true, color: C.text1 } }, { text: '  ·  ขนาด kWp  ·  จังหวัด', options: { color: C.accent5 } }], { placeholder: 'cap' + i });
      }
      s.addNotes('ใส่รูปผลงานจริง 6 งาน แล้วแก้คำบรรยายใต้รูป เช่น บ้านคุณ... · 10 kWp · นนทบุรี');
    }

    // ---------- installation steps ----------
    const terms = meta.terms && meta.terms.length ? meta.terms : [{ pct: 50, label: 'มัดจำ', when: 'เมื่ออนุมัติ' }, { pct: 40, label: 'งวดที่ 2', when: 'เมื่อติดตั้งแล้วเสร็จ' }, { pct: 10, label: 'งวดสุดท้าย', when: 'เมื่อ COD' }];
    {
      const s = pres.addSlide({ masterName: 'ST Content', sectionTitle: 'เกี่ยวกับเรา' });
      s.addText('ขั้นตอนการติดตั้งโซลาร์ Rooftop', { placeholder: 'title' });
      const steps = [
        ['สำรวจหน้างาน', 'ดูหลังคา ทิศ เงา ตู้ไฟ และบิลค่าไฟ', I.step1, HEX.blue],
        ['ออกแบบ & เสนอราคา', 'วางแผง เลือกขนาดระบบ ทำ Proposal', I.step2, HEX.blue],
        ['อนุมัติ & มัดจำ', `เซ็นสัญญา ชำระงวดแรก ${terms[0].pct}%`, I.step3, HEX.navy],
        ['ติดตั้งระบบ', 'ติดตั้งแผง อินเวอร์เตอร์ เดินสาย ตู้ไฟ', I.step4, HEX.orange],
        ['ยื่นขนานไฟ', 'ตรวจระบบ ยื่นเอกสารการไฟฟ้า นัดตรวจ', I.step5, HEX.green]
      ];
      const w = 9.0 / steps.length, d = 0.8, y0 = 1.55;
      s.addShape(pres.shapes.LINE, { x: 0.5 + w / 2, y: y0 + d / 2, w: w * (steps.length - 1), h: 0, line: { color: 'D9E1EF', width: 3 }, objectName: 'Steps line' });
      steps.forEach(([t, sub, ic, col], i) => {
        const cx = 0.5 + w * i + w / 2;
        circleIcon(s, ic, cx - d / 2, y0, d, col, 'Step ' + (i + 1));
        s.addText(String(i + 1), { x: cx + d / 2 - 0.22, y: y0 - 0.12, w: 0.3, h: 0.3, shape: pres.shapes.OVAL, fill: { color: C.background1 }, line: { color: col, width: 1.25 }, fontSize: 10, bold: true, color: col, align: 'center', valign: 'middle', margin: 0, objectName: 'Step number ' + (i + 1) });
        s.addText([{ text: t, options: { bold: true, fontSize: 14, color: C.text1, breakLine: true } }, { text: sub, options: { fontSize: 11, color: C.accent5 } }],
          { x: cx - w / 2 + 0.04, y: y0 + d + 0.15, w: w - 0.08, h: 1.3, align: 'center', valign: 'top', margin: 0, isTextBox: true, objectName: 'Step text ' + (i + 1) });
      });
      card(s, 0.5, 3.6, 9.0, 1.0, C.background2, 'Steps note');
      s.addText([
        { text: 'ดูแลให้ครบทุกขั้นตอน  ', options: { bold: true, color: C.text2 } },
        { text: `ทีมงาน SOLAR TOUCH ดูแลตั้งแต่สำรวจหน้างาน ติดตั้ง จนยื่นขนานไฟกับการไฟฟ้า ลูกค้าติดตามสถานะงานได้ตลอด และชำระเงินตามงวด ${terms.map(t => t.pct).join(' / ')}`, options: { color: C.text1 } }
      ], { x: 0.75, y: 3.65, w: 8.5, h: 0.9, fontSize: 12, valign: 'middle', margin: 0, isTextBox: true });
    }

    // ---------- terms & approval ----------
    pres.addSection({ title: 'สรุป' });
    {
      const s = pres.addSlide({ masterName: 'ST Closing', sectionTitle: 'สรุป' });
      s.addText('เงื่อนไขและการอนุมัติ', { placeholder: 'title' });
      const tw = (9.0 - 0.2 * (terms.length - 1)) / terms.length;
      terms.forEach((t, i) => {
        const x = 0.5 + i * (tw + 0.2);
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.15, w: tw, h: 1.35, rectRadius: 0.08, fill: { color: '15306A' }, line: { type: 'none' }, objectName: 'Payment ' + t.label });
        s.addText([{ text: t.pct + '%', options: { fontSize: 32, bold: true, color: HEX.sun, breakLine: true } }, { text: `${t.label} · ${t.when}`, options: { fontSize: 13, color: 'FFFFFF' } }],
          { x: x + 0.25, y: 1.25, w: tw - 0.4, h: 1.15, valign: 'middle', margin: 0, isTextBox: true });
      });
      s.addText('ราคารวมการออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตขนานไฟกับการไฟฟ้า · ข้อเสนอนี้มีอายุ 30 วัน', { x: 0.5, y: 2.7, w: 9, h: 0.4, fontSize: 12, color: 'BFCDEE', margin: 0, isTextBox: true });
      s.addText('เลือกทางเลือก   ' + OPTS.map(o => `☐ ${o.name} ${fk(o.kwp)} kWp`).join('   '), { x: 0.5, y: 3.25, w: 9, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF', margin: 0, isTextBox: true });
      const pr = meta.proposer || {};
      const prLines = [pr.name, [pr.phone || co.phone, pr.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
      [['ผู้เสนอ · SOLAR TOUCH', prLines || co.phone], ['ลูกค้าผู้อนุมัติ', customer]].forEach(([t, d], i) => {
        const x = 0.5 + i * 4.75;
        s.addShape(pres.shapes.LINE, { x, y: 4.35, w: 4.0, h: 0, line: { color: 'BFCDEE', width: 1 }, objectName: 'Signature line ' + (i + 1) });
        s.addText([{ text: t, options: { bold: true, color: 'FFFFFF', breakLine: true } }, { text: d, options: { color: 'BFCDEE' } }], { x, y: 4.42, w: 4.0, h: 0.75, fontSize: 11, valign: 'top', margin: 0, isTextBox: true });
      });
    }
    return pres;
  }

  /* ---------- post-process: theme colors + picture placeholders ---------- */
  const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  async function postProcess(buf, JSZip) {
    const zip = await JSZip.loadAsync(buf);
    const tp = 'ppt/theme/theme1.xml';
    if (zip.file(tp)) {
      const scheme = `<a:clrScheme name="${THEME.name}">` + SLOTS.map(k => `<a:${k}><a:srgbClr val="${THEME.colors[k]}"/></a:${k}>`).join('') + '</a:clrScheme>';
      const x = await zip.file(tp).async('string');
      zip.file(tp, x.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme).replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, h) => h + THEME.name + '"'));
    }
    // PptxGenJS writes image placeholders without type="pic"; mark them so PowerPoint offers "insert picture"
    const picIdx = {};
    for (const n of Object.keys(zip.files)) {
      const m = n.match(/^ppt\/slideLayouts\/(slideLayout\d+\.xml)$/); if (!m) continue;
      const ids = new Set();
      const x = (await zip.file(n).async('string')).replace(/<p:sp>[\s\S]*?<\/p:sp>/g, sp => {
        if (sp.indexOf(PIC_PROMPT) < 0) return sp;
        const id = sp.match(/idx="(\d+)"/); if (id) ids.add(id[1]);
        return sp.replace(/<p:ph\s/, '<p:ph type="pic" ');
      });
      zip.file(n, x); picIdx[m[1]] = ids;
    }
    for (const n of Object.keys(zip.files)) {
      const m = n.match(/^ppt\/slides\/(slide\d+)\.xml$/); if (!m) continue;
      const rel = zip.file(`ppt/slides/_rels/${m[1]}.xml.rels`); if (!rel) continue;
      const lay = ((await rel.async('string')).match(/slideLayouts\/(slideLayout\d+\.xml)/) || [])[1];
      const ids = picIdx[lay]; if (!ids || !ids.size) continue;
      zip.file(n, (await zip.file(n).async('string')).replace(/<p:sp>[\s\S]*?<\/p:sp>/g, sp => {
        const i = sp.match(/<p:ph[^>]*idx="(\d+)"/);
        return i && ids.has(i[1]) && sp.indexOf('type="pic"') < 0 ? sp.replace(/<p:ph\s/, '<p:ph type="pic" ') : sp;
      }));
    }
    return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }

  async function makePptx(PptxGenJS, JSZip, D, meta, assets) {
    const pres = buildDeck(PptxGenJS, D, meta, assets);
    const raw = await pres.write({ outputType: 'arraybuffer' });
    return postProcess(raw, JSZip);
  }

  const api = { DEFAULTS, calc, buildDeck, postProcess, makePptx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ST_PROPOSAL = api;
})(typeof window !== 'undefined' ? window : globalThis);
