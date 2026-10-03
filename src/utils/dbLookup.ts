import { StoreMerchant, ProjectRecord, PurchaseOrder, OrderRecord } from '../types';

export interface CatalogOption {
  value: string;
  subLabel?: string;
  badge?: string;
  meta?: Record<string, any>;
}

/**
 * Strips whitespace, punctuation, and common Thai company prefixes/suffixes
 * so that strings differing only by spaces, dots, or "บจก." vs "บริษัท ... จำกัด"
 * can be matched as similar.
 */
export function normalizeForFuzzyMatch(raw: string, stripCompanyAffixes = false): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();

  if (stripCompanyAffixes) {
    s = s
      .replace(/^(บริษัท|บจก\.?|บมจ\.?|ห้างหุ้นส่วนจำกัด|หจก\.?|หสม\.?|ร้าน)\s*/gi, '')
      .replace(/\s*(จำกัด\s*\(\s*มหาชน\s*\)|\(\s*มหาชน\s*\)|จำกัด|มหาชน)\s*$/gi, '');
  }

  // Remove all spaces, dots, dashes, parentheses, quotes, slashes for spacing/punctuation-insensitive comparison
  return s.replace(/[\s.\-_()[\]"'/,+]+/g, '');
}

/**
 * Computes Levenshtein edit distance between two strings (for catching 1-2 char typos)
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export interface DatabaseCatalog {
  stores: CatalogOption[];
  projects: CatalogOption[];
  categories: CatalogOption[];
  items: CatalogOption[];
  specs: CatalogOption[];
  units: CatalogOption[];
  locations: CatalogOption[];
  licensePlates: CatalogOption[];
  vehicleTypes: CatalogOption[];
  creditTerms: CatalogOption[];
  buyersAndStaff: CatalogOption[];
}

export const STANDARD_CONSTRUCTION_CATEGORIES: { value: string; subLabel: string }[] = [
  { value: 'หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง)', subLabel: 'หินคลุก, หินย่อย 3/4, หินฝุ่น, หินใหญ่เรียง, ทรายถม, ดินคันทาง, ลูกรัง (ทล./ทช.)' },
  { value: 'ยางมะตอย & ผิวทางลาดยาง (ทล./ทช.)', subLabel: 'แอสฟัลต์คอนกรีต (Hot Mix AC), ยางน้ำ Prime Coat (MC-70), Tack Coat (CRS-2, CSS-1)' },
  { value: 'คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต', subLabel: 'คอนกรีต 240-400 KSC, คอนกรีตถนน (Pavement), คอนกรีตหยาบ, คอนกรีตโครงสร้างสะพาน' },
  { value: 'งานสะพาน & คอนกรีตอัดแรง', subLabel: 'เสาเข็มตอก/เจาะ, คานสะพาน I-Girder/Box Girder, แผ่นพื้น Precast, ลวด PC Strand, ยางรองคาน Bearing Pad, Expansion Joint' },
  { value: 'เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน', subLabel: 'เหล็กเส้นกลม RB, ข้ออ้อย DB (SD40/SD50), Wire Mesh, เหล็กเดือย Dowel/Tie Bar, H-Beam' },
  { value: 'งานท่อระบายน้ำ & รางระบายน้ำ', subLabel: 'ท่อ คสล. มอก. ชั้น 1-3, ท่อเหลี่ยม Box Culvert, ราง U-Ditch, บ่อพัก, ท่อ HDPE/PVC' },
  { value: 'งานอำนวยความปลอดภัย & จราจร (ทล./ทช.)', subLabel: 'การ์ดเรล Guardrail, สีตีเส้นเทอร์โมพลาสติก, ลูกแก้วสะท้อนแสง, ป้ายจราจร, หมุดถนน, เสาไฟทางหลวง, แบริเออร์' },
  { value: 'งานป้องกันการกัดเซาะ & กำแพงกันดิน', subLabel: 'กล่องเกเบี้ยน Gabion/Mattress, แผ่นใยสังเคราะห์ Geotextile, หินเรียงยาแนว, Sheet Pile' },
  { value: 'ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง', subLabel: 'ปูนปอร์ตแลนด์, ปูนไฮดรอลิก, Non-Shrink Grout, น้ำยาบ่มคอนกรีต, ยางหยอดร่อง Joint Sealer, อิฐ' },
  { value: 'ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง', subLabel: 'แบบเหล็ก, ไม้อัดดำ, นั่งร้าน, ลวดผูกเหล็ก, ตะปู, ใบตัด' },
  { value: 'เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง', subLabel: 'น้ำมันดีเซล B7, ไฮดรอลิก, จาระบี, เช่าเครื่องจักร (รถบด/เกรดเดอร์/ปูยาง/เครน/แบคโฮ)' },
  { value: 'งานขนส่ง & โลจิสติกส์', subLabel: 'ค่าบรรทุกหิน/ดิน/ทราย, รถพ่วงดั๊มพ์, รถเทรลเลอร์ขนย้ายเครื่องจักร/คานสะพาน' },
  { value: 'ระบบไฟฟ้า & ประปาสนาม', subLabel: 'สายไฟ, ท่อร้อยสาย, ตู้ไฟ, โคมไฟส่องสว่าง, ท่อประปา, วาล์ว' },
  { value: 'วัสดุก่อสร้างทั่วไป', subLabel: 'วัสดุอุปกรณ์ก่อสร้างและฮาร์ดแวร์ทั่วไป' }
];

/**
 * Automatically infers material/construction category (Col 3) from item description, spec, store category, or PO category
 * Covers general construction, road & highway engineering, bridge structures, DOH (กรมทางหลวง) & DRR (กรมทางหลวงชนบท).
 */
export function inferMaterialCategory(
  itemText?: string,
  storeCategory?: string,
  poCategory?: string,
  currentCategory?: string,
  specText?: string
): string {
  const cleanCurrent = (currentCategory || '').trim();
  if (
    cleanCurrent &&
    cleanCurrent !== '-' &&
    cleanCurrent !== 'ทั่วไป' &&
    cleanCurrent !== 'ไม่ระบุ' &&
    cleanCurrent !== 'วัสดุก่อสร้างทั่วไป'
  ) {
    return cleanCurrent;
  }

  const text = `${itemText || ''} ${specText || ''}`.toLowerCase();

  // 1. ยางมะตอย & ผิวทางลาดยาง (Road Asphalt & Bitumen - DOH/DRR)
  if (/(ยางมะตอย|แอสฟัลต์|asphalt|hot\s*mix|ac\s*60\/70|mc-?70|crs-?2|css-?1|pma|prime\s*coat|tack\s*coat|ไพร์มโค้ท|แทคโค้ท|หินคลุกผสมยาง|ลาดยาง)/.test(text)) {
    return 'ยางมะตอย & ผิวทางลาดยาง (ทล./ทช.)';
  }

  // 2. งานสะพาน & คอนกรีตอัดแรง (Bridge & Precast/Prestressed Structures)
  if (/(คานสะพาน|girder|box\s*girder|i-?girder|plank|เสาเข็ม|spun\s*pile|เข็มเจาะ|เข็มตอก|แผ่นพื้นสำเร็จ|precast|pc\s*strand|ลวดอัดแรง|post-?tension|bearing\s*pad|ยางรองคาน|expansion\s*joint|รอยต่อสะพาน|ตอม่อ|ราวสะพาน|พื้นสะพาน)/.test(text)) {
    return 'งานสะพาน & คอนกรีตอัดแรง';
  }

  // 3. งานอำนวยความปลอดภัย & จราจร (Highway Safety & Traffic Control - กรมทางหลวง/ทช.)
  if (/(การ์ดเรล|guard\s*rail|ราวกันอันตราย|สีตีเส้น|เทอร์โมพลาสติก|thermoplastic|ลูกแก้วสะท้อนแสง|glass\s*bead|ป้ายจราจร|ป้ายทางหลวง|หมุดสะท้อนแสง|road\s*stud|แบริเออร์|barrier|เสาไฟทางหลวง|high\s*mast|ไฟกระพริบ|กรวยจราจร|หลักนำทาง)/.test(text)) {
    return 'งานอำนวยความปลอดภัย & จราจร (ทล./ทช.)';
  }

  // 4. งานป้องกันการกัดเซาะ & กำแพงกันดิน (Slope Protection, Gabion, Geotextile)
  if (/(เกเบี้ยน|gabion|mattress|แมทเทรส|geotextile|จีโอเท็กซ์ไทล์|แผ่นใยสังเคราะห์|sheet\s*pile|ชีทไพล์|กำแพงกันดิน|retaining\s*wall|หินเรียงยาแนว)/.test(text)) {
    return 'งานป้องกันการกัดเซาะ & กำแพงกันดิน';
  }

  // 5. งานท่อระบายน้ำ & รางระบายน้ำ (Drainage, Culverts, U-Ditch)
  if (/(ท่อ\s*คสล|ท่อคอนกรีต|box\s*culvert|บ็อกซ์คัลเวิร์ต|ท่อเหลี่ยม|u-?ditch|รางระบายน้ำ|บ่อพัก|manhole|ฝาตะแกรง|ท่อลอด|ท่อ\s*hdpe|ท่อ\s*pvc|ท่อ\s*pe|ท่อระบายน้ำ)/.test(text)) {
    return 'งานท่อระบายน้ำ & รางระบายน้ำ';
  }

  // 6. หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง - Subbase, Base Course, Aggregates)
  if (/(หินคลุก|ctb|หินย่อย|หิน\s*1|หิน\s*2|หิน\s*3\/4|หินฝุ่น|หินใหญ่|หินเรียง|riprap|ทรายหยาบ|ทรายละเอียด|ทรายถม|ทรายคัด|ดินถม|ดินคันทาง|ดินคัดเลือก|selected|ลูกรัง|subbase|base\s*course|มวลรวม)/.test(text)) {
    return 'หิน/ดิน/ทราย (ชั้นทาง & พื้นทาง)';
  }

  // 7. คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต (Ready-Mixed & Pavement Concrete)
  if (/(คอนกรีต|ปูนผสมเสร็จ|ksc|cube|cylinder|slump|มิกซ์|รัดหัวเข็ม|เทพื้น|คอนกรีตหยาบ|lean\s*concrete|pavement)/.test(text)) {
    return 'คอนกรีตผสมเสร็จ & ผิวทางคอนกรีต';
  }

  // 8. เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน (Rebar, Dowel Bar, Structural Steel)
  if (/(เหล็กเส้น|เหล็กข้ออ้อย|เหล็กกลม|\brb\d|\bdb\d|sr24|sd40|sd50|ไวร์เมช|wire\s*mesh|dowel\s*bar|เหล็กเดือย|tie\s*bar|เหล็กยึด|เหล็กรูปพรรณ|h-?beam|i-?beam|เหล็กกล่อง|เหล็กตัวซี|เหล็กฉาก|แผ่นเหล็ก|เพลทเหล็ก)/.test(text)) {
    return 'เหล็กเส้น & เหล็กโครงสร้างสะพาน/ถนน';
  }

  // 9. ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง (Cement, Grout, Curing, Joint Sealer)
  if (/(ปูนซีเมนต์|ปูนถุง|ปูนปอร์ตแลนด์|ปูนไฮดรอลิก|ปูนก่อ|ปูนฉาบ|ปูนกาว|non-?shrink|เกราท์|grout|น้ำยาบ่ม|curing|ยางหยอดร่อง|joint\s*sealer|อิฐมอญ|อิฐมวลเบา|อิฐบล็อก)/.test(text)) {
    return 'ปูนซีเมนต์ & เคมีภัณฑ์ก่อสร้าง';
  }

  // 10. เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง (Heavy Machinery & Fuel)
  if (/(น้ำมัน|ดีเซล|เบนซิน|ไฮดรอลิก|จาระบี|เชื้อเพลิง|รถบด|รถเกรด|รถปูยาง|รถแบคโฮ|รถขุด|รถเครน|เช่าเครื่องจักร|อะไหล่เครื่องจักร)/.test(text)) {
    return 'เครื่องจักรกลหนัก & น้ำมันเชื้อเพลิง';
  }

  // 11. ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง (Formwork, Scaffolding, Consumables)
  if (/(ไม้แบบ|แบบเหล็ก|ไม้อัด|ไม้ยูคา|นั่งร้าน|scaffolding|ลวดผูกเหล็ก|ตะปู|ใบตัด|วัสดุสิ้นเปลือง)/.test(text)) {
    return 'ไม้แบบ นั่งร้าน & วัสดุสิ้นเปลือง';
  }

  // 12. ระบบไฟฟ้า & ประปาสนาม
  if (/(สายไฟ|ท่อร้อยสาย|ตู้ไฟ|เบรกเกอร์|โคมไฟ|สวิตช์|ปลั๊ก|ท่อประปา|วาล์ว|ประตูน้ำ)/.test(text)) {
    return 'ระบบไฟฟ้า & ประปาสนาม';
  }

  const cleanPO = (poCategory || '').trim();
  if (cleanPO && cleanPO !== '-' && cleanPO !== 'ทั่วไป') return cleanPO;

  const cleanStore = (storeCategory || '').trim();
  if (cleanStore && cleanStore !== '-' && cleanStore !== 'ทั่วไป') return cleanStore;

  return cleanCurrent || 'วัสดุก่อสร้างทั่วไป';
}

/**
 * Builds a unified deduplicated lookup catalog from existing localStorage collections:
 * stores, projects, purchase orders (pos), and order records (orders).
 */
export function buildDatabaseCatalog(
  stores: StoreMerchant[] = [],
  projects: ProjectRecord[] = [],
  pos: PurchaseOrder[] = [],
  orders: OrderRecord[] = []
): DatabaseCatalog {
  const storeMap = new Map<string, CatalogOption>();
  const projectMap = new Map<string, CatalogOption>();
  const categoryMap = new Map<string, CatalogOption>();
  const itemMap = new Map<string, CatalogOption>();
  const specMap = new Map<string, CatalogOption>();
  const unitMap = new Map<string, CatalogOption>();
  const locationMap = new Map<string, CatalogOption>();
  const plateMap = new Map<string, CatalogOption>();
  const vehicleMap = new Map<string, CatalogOption>();
  const creditMap = new Map<string, CatalogOption>();
  const staffMap = new Map<string, CatalogOption>();

  const addOption = (map: Map<string, CatalogOption>, value: string | undefined, subLabel?: string, badge?: string, meta?: Record<string, any>) => {
    const clean = (value || '').trim();
    if (!clean || clean === '-' || clean === 'ไม่ระบุผู้ขาย' || clean === 'ผู้จำหน่ายไม่ระบุชื่อ') return;
    const key = clean.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { value: clean, subLabel, badge, meta });
    } else {
      const existing = map.get(key)!;
      if (!existing.subLabel && subLabel) existing.subLabel = subLabel;
      if (!existing.badge && badge) existing.badge = badge;
      if (meta) existing.meta = { ...(existing.meta || {}), ...meta };
    }
  };

  // 1. Stores Directory
  for (const s of stores) {
    addOption(
      storeMap,
      s.name,
      [s.category, s.creditTerms].filter(Boolean).join(' • '),
      'ทะเบียนร้านค้า',
      { storeId: s.id, category: s.category, creditTerms: s.creditTerms, taxId: s.taxId, primaryGoods: s.primaryGoods }
    );
    if (s.creditTerms) addOption(creditMap, s.creditTerms, 'เงื่อนไขในทะเบียนร้านค้า');
    if (s.primaryGoods) {
      for (const g of s.primaryGoods) {
        addOption(itemMap, g, `สินค้าหลักของ ${s.name}`, s.category, { storeName: s.name });
      }
    }
  }

  // 2. Projects Directory
  for (const p of projects) {
    addOption(
      projectMap,
      p.name,
      [p.code, p.location].filter(Boolean).join(' • '),
      'ทะเบียนโครงการ',
      { projectId: p.id, location: p.location, code: p.code }
    );
    if (p.location) {
      addOption(locationMap, p.location, `สถานที่ของ ${p.name}`, 'จากโครงการ');
    }
    if (p.manager) {
      addOption(staffMap, p.manager, `ผู้จัดการโครงการ ${p.name}`);
    }
  }

  // 3. Purchase Orders (POs)
  for (const po of pos) {
    addOption(storeMap, po.storeName, po.category, 'จากใบสั่งซื้อ PO', { category: po.category, creditTerms: po.creditTerms });
    addOption(projectMap, po.projectId, `จาก PO ${po.poNumber}`, 'เคยใช้ใน PO');
    addOption(locationMap, po.deliveryLocation, `จัดส่งใน PO ${po.poNumber}`, 'สถานที่จัดส่ง');
    addOption(creditMap, po.creditTerms, 'เงื่อนไขชำระเงิน PO');
    addOption(staffMap, po.orderedBy, 'ผู้สั่งซื้อ');
    addOption(staffMap, po.approvedBy, 'ผู้อนุมัติ');

    if (po.items) {
      for (const item of po.items) {
        addOption(
          itemMap,
          item.itemDescription,
          [
            item.specCode ? `สเปก: ${item.specCode}` : '',
            item.unit ? `หน่วย: ${item.unit}` : '',
            item.unitPrice ? `฿${item.unitPrice.toLocaleString()}/${item.unit || 'หน่วย'}` : ''
          ].filter(Boolean).join(' • '),
          `PO: ${po.poNumber}`,
          {
            specCode: item.specCode,
            unit: item.unit,
            unitPrice: item.unitPrice,
            storeName: po.storeName
          }
        );
        if (item.specCode) addOption(specMap, item.specCode, item.itemDescription, 'สเปกใน PO');
        if (item.unit) addOption(unitMap, item.unit, 'หน่วยนับ');
      }
    }
  }

  // 4. Orders (DO, Weighbridge, Tax Invoice)
  for (const ord of orders) {
    addOption(storeMap, ord.col8, ord.col3, 'จากประวัติบิล', { category: ord.col3 });
    addOption(projectMap, ord.col2, `บิล ${ord.col6 || ord.col1}`, 'เคยใช้ในบิล');
    addOption(
      itemMap,
      ord.col11,
      [
        ord.col12 ? `สเปก: ${ord.col12}` : '',
        ord.col23 ? `หน่วย: ${ord.col23}` : '',
        ord.col24 ? `฿${Number(ord.col24).toLocaleString()}` : ''
      ].filter(Boolean).join(' • '),
      ord.col8 ? `ร้าน: ${ord.col8}` : 'จากประวัติบิล',
      {
        specCode: ord.col12,
        unit: ord.col23,
        unitPrice: ord.col24,
        storeName: ord.col8
      }
    );
    if (ord.col12) addOption(specMap, ord.col12, ord.col11, 'สเปกจากบิล');
    if (ord.col23) addOption(unitMap, ord.col23, 'หน่วยนับ');
    if (ord.col10) addOption(plateMap, ord.col10, ord.col8 ? `รถส่งจาก ${ord.col8}` : 'ทะเบียนรถเคยเข้าหน้างาน', ord.col26 || 'ทะเบียนรถ');
    if (ord.col26) addOption(vehicleMap, ord.col26, 'ประเภทรถ');
    if (ord.col37) addOption(locationMap, ord.col37, ord.col2 || 'จุดส่งหน้างาน', 'สถานที่ส่งมอบ');
    if (ord.col9) addOption(staffMap, ord.col9, 'ผู้รับสินค้า / ผู้ซื้อ');

    if (ord.lineItems) {
      for (const li of ord.lineItems) {
        addOption(
          itemMap,
          li.itemDescription,
          [li.specCode ? `สเปก: ${li.specCode}` : '', li.unit ? `หน่วย: ${li.unit}` : ''].filter(Boolean).join(' • '),
          'รายการย่อยในบิล',
          { specCode: li.specCode, unit: li.unit, unitPrice: li.unitPrice }
        );
        if (li.specCode) addOption(specMap, li.specCode, li.itemDescription);
        if (li.unit) addOption(unitMap, li.unit, 'หน่วยนับ');
      }
    }
  }

  // Standard defaults for units, vehicle types, and credit terms so the list is always helpful
  let dynamicUnits = ['ตัน', 'คิว', 'เส้น', 'ถุง', 'ท่อน', 'แผ่น', 'ชุด', 'อัน', 'ท่อ', 'กล่อง', 'ม้วน', 'กก.', 'เที่ยว', 'งาน'];
  try {
    const rawSettings = localStorage.getItem('autostore_system_settings_v1');
    if (rawSettings) {
      const parsedSettings = JSON.parse(rawSettings);
      if (Array.isArray(parsedSettings?.customUnits) && parsedSettings.customUnits.length > 0) {
        dynamicUnits = Array.from(new Set([...parsedSettings.customUnits, ...dynamicUnits]));
      }
    }
  } catch {
    // ignore storage parse error
  }
  for (const u of dynamicUnits) {
    addOption(unitMap, u, 'หน่วยมาตรฐาน');
  }
  for (const v of [
    'พ่วง 18 ล้อ',
    'พ่วง 22 ล้อ',
    'สิบล้อดั๊มพ์',
    'หกล้อดั๊มพ์',
    'รถโม่คอนกรีต',
    'รถเทรลเลอร์โลว์เบด (ขนเครื่องจักร/คานสะพาน)',
    'รถสเปรย์ยางมะตอย',
    'รถบรรทุกน้ำ',
    'รถเฮี๊ยบติดเครน',
    'รถกระบะ'
  ]) {
    addOption(vehicleMap, v, 'ประเภทรถมาตรฐานงานก่อสร้าง/ทางหลวง');
  }
  for (const sp of [
    'ทล. 201 (รองพื้นทางวัสดุมวลรวม)',
    'ทล. 205 (พื้นทางหินคลุก)',
    'ทล. 206 (พื้นทางหินคลุกผสมซีเมนต์ CTB)',
    'ทล. 401 (Prime Coat MC-70)',
    'ทล. 402 (Tack Coat CRS-2)',
    'ทล. 408 (แอสฟัลต์คอนกรีต AC 60/70)',
    'ทล. 309 (ผิวทางคอนกรีตปอร์ตแลนด์)',
    'มอก. 128 ชั้น 2 (ท่อ คสล. อัดแรง)',
    'มอก. 128 ชั้น 3 (ท่อ คสล. รับน้ำหนักสูง)',
    'SD40 มอก. 24-2559',
    'SD50 มอก. 24-2559',
    'SR24 มอก. 20-2559',
    '280 KSC Cube (Slump 10±2.5 cm)',
    '320 KSC Cylinder (งานโครงสร้างสะพาน)',
    '400 KSC (งานคอนกรีตอัดแรง/คานสะพาน)'
  ]) {
    addOption(specMap, sp, 'สเปกมาตรฐาน งานทางหลวง/สะพาน/ก่อสร้าง');
  }
  for (const c of ['เครดิต 30 วัน', 'เครดิต 15 วัน', 'เครดิต 45 วัน', 'เครดิต 60 วัน', 'เงินสด', 'โอนเงินธนาคาร', 'วางบิลตามงวดงาน']) {
    addOption(creditMap, c, 'เงื่อนไขมาตรฐาน');
  }
  for (const cat of STANDARD_CONSTRUCTION_CATEGORIES) {
    addOption(categoryMap, cat.value, cat.subLabel, 'มาตรฐานงานก่อสร้าง/ถนน/สะพาน/ทล.');
  }
  for (const s of stores) {
    if (s.category) addOption(categoryMap, s.category, `หมวดหมู่ของร้าน ${s.name}`, 'จากทะเบียนร้านค้า');
  }
  for (const po of pos) {
    if (po.category) addOption(categoryMap, po.category, `หมวดหมู่ใน PO ${po.poNumber}`, 'จากใบสั่งซื้อ PO');
  }
  for (const ord of orders) {
    if (ord.col3) addOption(categoryMap, ord.col3, 'เคยใช้ในบิลรับของ', 'จากประวัติบิล');
  }

  return {
    stores: Array.from(storeMap.values()),
    projects: Array.from(projectMap.values()),
    categories: Array.from(categoryMap.values()),
    items: Array.from(itemMap.values()),
    specs: Array.from(specMap.values()),
    units: Array.from(unitMap.values()),
    locations: Array.from(locationMap.values()),
    licensePlates: Array.from(plateMap.values()),
    vehicleTypes: Array.from(vehicleMap.values()),
    creditTerms: Array.from(creditMap.values()),
    buyersAndStaff: Array.from(staffMap.values())
  };
}

export interface LookupAnalysis {
  exactMatch: CatalogOption | null;
  fuzzySimilarMatches: CatalogOption[];
  filteredOptions: CatalogOption[];
}

/**
 * Analyzes the user's current input value against a catalog list:
 * - `exactMatch`: 100% identical string (after trim) exists in DB
 * - `fuzzySimilarMatches`: Differs by spaces, punctuation, company prefix ("บจก." vs "บริษัท"), or 1-2 char typo!
 * - `filteredOptions`: Options matching the current search text (for dropdown selection)
 */
export function analyzeDatabaseLookup(
  inputValue: string,
  options: CatalogOption[],
  isStoreField = false
): LookupAnalysis {
  const trimmed = (inputValue || '').trim();
  if (!trimmed) {
    return {
      exactMatch: null,
      fuzzySimilarMatches: [],
      filteredOptions: options.slice(0, 30)
    };
  }

  const lowerInput = trimmed.toLowerCase();
  const normInput = normalizeForFuzzyMatch(trimmed, isStoreField);
  const normInputRaw = normalizeForFuzzyMatch(trimmed, false);

  let exactMatch: CatalogOption | null = null;
  const fuzzySimilarMatches: { opt: CatalogOption; score: number }[] = [];
  const filtered: { opt: CatalogOption; rank: number }[] = [];

  for (const opt of options) {
    const optTrimmed = opt.value.trim();
    const optLower = optTrimmed.toLowerCase();

    if (optTrimmed === trimmed || optLower === lowerInput) {
      if (optTrimmed === trimmed) {
        exactMatch = opt;
      } else {
        // Case difference only
        fuzzySimilarMatches.push({ opt, score: 100 });
      }
      filtered.push({ opt, rank: 100 });
      continue;
    }

    const normOpt = normalizeForFuzzyMatch(optTrimmed, isStoreField);
    const normOptRaw = normalizeForFuzzyMatch(optTrimmed, false);

    // 1. Same normalized text (e.g. spacing error, dot error, or "บจก." vs "บริษัท ... จำกัด")
    if ((normInput.length >= 2 && normInput === normOpt) || (normInputRaw.length >= 2 && normInputRaw === normOptRaw)) {
      fuzzySimilarMatches.push({ opt, score: 95 });
      filtered.push({ opt, rank: 95 });
      continue;
    }

    // 2. Substring match on normalized text (e.g., user typed partial word or AI included extra suffix)
    if (normInput.length >= 2 && (normOpt.includes(normInput) || normInput.includes(normOpt))) {
      const lenRatio = Math.min(normInput.length, normOpt.length) / Math.max(normInput.length, normOpt.length);
      if (lenRatio >= 0.55) {
        fuzzySimilarMatches.push({ opt, score: Math.round(75 * lenRatio) });
      }
      filtered.push({ opt, rank: 80 });
      continue;
    }

    // 3. Edit distance / Typo detection (e.g. พิมพ์ผิด สะกดผิด 1-2 ตัวอักษร)
    if (normInput.length >= 3 && normOpt.length >= 3 && Math.abs(normInput.length - normOpt.length) <= 3) {
      const dist = editDistance(normInput, normOpt);
      const maxAllowedDist = normInput.length <= 5 ? 1 : normInput.length <= 10 ? 2 : 3;
      if (dist <= maxAllowedDist) {
        const similarity = 90 - dist * 10;
        fuzzySimilarMatches.push({ opt, score: similarity });
        filtered.push({ opt, rank: similarity });
        continue;
      }
    }

    // 4. SubLabel match for dropdown filtering
    if (opt.subLabel && opt.subLabel.toLowerCase().includes(lowerInput)) {
      filtered.push({ opt, rank: 40 });
    }
  }

  fuzzySimilarMatches.sort((a, b) => b.score - a.score);
  filtered.sort((a, b) => b.rank - a.rank);

  return {
    exactMatch,
    fuzzySimilarMatches: fuzzySimilarMatches.slice(0, 4).map(x => x.opt),
    // If filtered is empty (because the scanned text is very different), still provide top options in dropdown when user clicks "ดูทั้งหมด"
    filteredOptions: filtered.map(x => x.opt).slice(0, 25)
  };
}
