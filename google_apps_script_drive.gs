/**
 * ==============================================================================
 * SmartWeigh AI — Google Apps Script (GAS) Drive Engine
 * ระบบจัดเก็บและจัดการไฟล์ Google Drive อัตโนมัติ (Zero-Junk & Verified-Only Move)
 * ใช้งานผ่านบัญชี Google ส่วนตัวได้ทันที — ไม่ต้องใช้ Google Service Account
 * ==============================================================================
 * 
 * 📌 ขั้นตอนการติดตั้ง (ทำครั้งเดียว 1 นาที):
 * 1. เปิด https://script.google.com แล้วกดปุ่ม "+ โครงการใหม่" (New project)
 * 2. ลบโค้ดเดิมในหน้าต่างออกทั้งหมด แล้วคัดลอกโค้ดไฟล์นี้ทั้งหมดไปวาง
 * 3. กดปุ่ม "การทำให้ใช้งานได้" (Deploy) มุมขวาบน -> เลือก "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 * 4. คลิกที่ไอคอนฟันเฟือง ⚙️ ทางซ้าย แล้วเลือก "เว็บแอป" (Web app)
 * 5. กำหนดค่าดังนี้:
 *    - คำอธิบาย (Description): SmartWeigh Drive API
 *    - ดำเนินการในฐานะ (Execute as): "ฉัน (Me)"
 *    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): "ทุกคน (Anyone)"  <-- สำคัญมาก! เพื่อให้ระบบส่งรูปเข้ามาได้
 * 6. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) -> กด "ให้สิทธิ์การเข้าถึง" (Authorize access) แล้วกดยอมรับ
 * 7. ในหน้า Settings ของ SmartWeigh AI กด "สร้างรหัสให้และคัดลอก"
 * 8. ไปที่ Project Settings -> Script Properties แล้วเพิ่ม
 *    SMARTWEIGH_SHARED_SECRET จากรหัสที่คัดลอกจากหน้าเว็บ
 *    (ห้ามบันทึกลง source code)
 * 9. คัดลอก Web app URL ที่ลงท้ายด้วย /exec ไปวางในหน้าตั้งค่า SmartWeigh AI
 *    และ Deploy source รุ่นนี้ใหม่ทุกครั้งเมื่อเปลี่ยนโค้ด
 * ==============================================================================
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'ไม่พบข้อมูลคำขอ (No POST payload)' });
    }

    var payload = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('SMARTWEIGH_SHARED_SECRET');
    if (!expectedSecret || typeof payload.sharedSecret !== 'string' || payload.sharedSecret !== expectedSecret) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }
    delete payload.sharedSecret;
    var action = payload.action;

    if (action === 'test') {
      return handleTestConnection(payload);
    } else if (action === 'upload') {
      return handleUploadFile(payload);
    } else if (action === 'get_image') {
      return handleGetImage(payload);
    } else if (action === 'sync_verified_move') {
      return handleMoveFile(payload);
    } else if (action === 'sync_tax_invoice_links') {
      return handleSyncTaxInvoiceLinks(payload);
    } else if (action === 'rename_and_move') {
      return handleRenameAndMoveFile(payload);
    } else if (action === 'restore_line_inbox_file') {
      return handleRestoreLineInboxFile(payload);
    } else if (action === 'verify_do_file_location') {
      return handleVerifyDoFileLocation(payload);
    } else if (action === 'cleanup_empty_do_folder') {
      return handleCleanupEmptyDoFolder(payload);
    } else if (action === 'cleanup') {
      return handleCleanup(payload);
    } else if (action === 'list_zone_files') {
      return handleListZoneFiles(payload);
    } else if (action === 'quarantine_inbox_file') {
      return handleQuarantineInboxFile(payload);
    } else {
      return jsonResponse({ success: false, error: 'ไม่รู้จัก action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return jsonResponse({
    success: true,
    service: 'SmartWeigh AI - Google Drive Engine (GAS)',
    status: 'Ready',
    timestamp: new Date().toISOString()
  });
}

// ------------------------------------------------------------------------------
// Handlers & Zone Definitions
// ------------------------------------------------------------------------------

var ZONE_NAMES = {
  ZONE_00: '00_กล่องพักบิล_LINE_รอตรวจรับ',
  ZONE_01: '01_ใบสั่งซื้อ_PO',
  ZONE_02: '02_ใบงานหลัก_DO_ครบชุด',
  ZONE_03: '03_ตั๋วชั่งปลายทาง_รอจับคู่DO',
  ZONE_04: '04_ใบเสร็จกำกับภาษี_เอกเทศ',
  ZONE_99: '99_ถังขยะ_รอทำลาย_30วัน'
};

var ZONE_KEY_MAP = {
  'zone_00': 'ZONE_00',
  'zone_01': 'ZONE_01',
  'zone_02': 'ZONE_02',
  'zone_03': 'ZONE_03',
  'zone_04': 'ZONE_04',
  'trash': 'ZONE_99'
};

function getOrCreateSubfolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    var folder = folders.next();
    if (folders.hasNext()) {
      throw new Error('พบโฟลเดอร์ชื่อ "' + folderName + '" ซ้ำกันใต้โฟลเดอร์เดียวกัน');
    }
    return folder;
  }
  return parentFolder.createFolder(folderName);
}

function sanitizeDriveName(rawName) {
  return String(rawName || 'DOC')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_');
}

function handleTestConnection(payload) {
  var rootFolderId = payload.rootFolderId;
  if (!rootFolderId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId' });
  }

  var rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (err) {
    return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์หลัก กรุณาตรวจสอบ Root Folder ID: ' + err.toString() });
  }

  var zonesCreated = {};
  for (var key in ZONE_NAMES) {
    var folder = getOrCreateSubfolder(rootFolder, ZONE_NAMES[key]);
    zonesCreated[key] = folder.getId();
  }

  return jsonResponse({
    success: true,
    message: 'เชื่อมต่อ Google Drive ผ่าน Google Apps Script สำเร็จ และตรวจสอบ 5 โซนมาตรฐานเรียบร้อย',
    rootFolderId: rootFolder.getId(),
    rootFolderName: rootFolder.getName(),
    zonesCreated: zonesCreated
  });
}

function handleUploadFile(payload) {
  var rootFolderId = payload.rootFolderId;
  var targetFolderId = payload.targetFolderId;
  var targetZone = payload.targetZone; // 'zone_00' | 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04'
  var subfolderName = payload.subfolderName; // เช่น TR-xxxx_DO-xxxx
  var fileName = payload.fileName || ('FILE_' + Date.now() + '.jpg');
  var base64Image = payload.base64Image;

  if (!base64Image) {
    return jsonResponse({ success: false, error: 'ไม่พบข้อมูลรูปภาพ base64Image' });
  }

  var rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(rootFolderId);
  } catch (err) {
    return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์หลัก: ' + err.toString() });
  }

  var destFolder;
  if (targetFolderId) {
    try {
      destFolder = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      destFolder = rootFolder;
    }
  } else if (targetZone && ZONE_KEY_MAP[targetZone]) {
    var zoneName = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
    destFolder = getOrCreateSubfolder(rootFolder, zoneName);
  } else {
    destFolder = rootFolder;
  }

  // หากระบุชื่อโฟลเดอร์ย่อย (เช่น โฟลเดอร์ใบงานประจำ DO ใน 02_ใบงานหลัก_DO_ครบชุด)
  if (subfolderName) {
    destFolder = getOrCreateSubfolder(destFolder, subfolderName);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var existingFiles = destFolder.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      return jsonResponse({
        success: true,
        alreadyExists: true,
        fileId: existingFile.getId(),
        fileName: existingFile.getName(),
        folderId: destFolder.getId(),
        webViewLink: existingFile.getUrl()
      });
    }

    // ตัด Prefix data:image/...;base64, ออกหากมี
    var cleanBase64 = base64Image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    var decodedBytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(decodedBytes, 'image/jpeg', fileName);
    var file = destFolder.createFile(blob);

    return jsonResponse({
      success: true,
      fileId: file.getId(),
      fileName: file.getName(),
      folderId: destFolder.getId(),
      webViewLink: file.getUrl()
    });
  } finally {
    lock.releaseLock();
  }
}

function handleGetImage(payload) {
  if (!payload.fileId || !payload.rootFolderId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ fileId และ rootFolderId' });
  }

  try {
    var file = DriveApp.getFileById(payload.fileId);
    if (!isFileUnderRoot(file, payload.rootFolderId)) {
      return jsonResponse({ success: false, error: 'ไฟล์รูปภาพไม่ได้อยู่ในโฟลเดอร์ระบบที่กำหนด' });
    }
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
      return jsonResponse({ success: false, error: 'ขนาดหรือข้อมูลรูปภาพไม่ถูกต้อง' });
    }
    return jsonResponse({
      success: true,
      mimeType: blob.getContentType(),
      base64Data: Utilities.base64Encode(bytes)
    });
  } catch (err) {
    return jsonResponse({ success: false, error: 'อ่านภาพจาก Google Drive ไม่สำเร็จ: ' + err.toString() });
  }
}

function isFileUnderRoot(file, rootFolderId) {
  var pendingFolders = [];
  var checkedFolders = {};
  var parents = file.getParents();
  while (parents.hasNext()) {
    pendingFolders.push(parents.next().getId());
  }

  for (var depth = 0; pendingFolders.length && depth < 8; depth++) {
    var folderId = pendingFolders.shift();
    if (folderId === rootFolderId) {
      return true;
    }
    if (checkedFolders[folderId]) {
      continue;
    }
    checkedFolders[folderId] = true;
    var folderParents = DriveApp.getFolderById(folderId).getParents();
    while (folderParents.hasNext()) {
      pendingFolders.push(folderParents.next().getId());
    }
  }
  return false;
}

function handleMoveFile(payload) {
  var fileId = payload.fileId;
  var targetFolderId = payload.targetFolderId;
  var rootFolderId = payload.rootFolderId;
  var targetZone = payload.targetZone;
  var subfolderName = payload.subfolderName;

  if (!fileId) {
    return jsonResponse({ success: false, error: 'ระบุ fileId ไม่ครบ' });
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return jsonResponse({ success: false, error: 'ไม่พบไฟล์: ' + e.toString() });
  }

  var targetFolder;
  if (targetFolderId) {
    try {
      targetFolder = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      return jsonResponse({ success: false, error: 'ไม่พบโฟลเดอร์ปลายทาง: ' + e.toString() });
    }
  } else if (rootFolderId && targetZone && ZONE_KEY_MAP[targetZone]) {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var zoneName = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
    targetFolder = getOrCreateSubfolder(rootFolder, zoneName);
    if (subfolderName) {
      targetFolder = getOrCreateSubfolder(targetFolder, subfolderName);
    }
  } else {
    return jsonResponse({ success: false, error: 'ไม่ระบุเป้าหมายการย้ายไฟล์' });
  }

  file.moveTo(targetFolder);

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    targetFolderId: targetFolder.getId(),
    message: 'ย้ายไฟล์ไปยังโฟลเดอร์เป้าหมายสำเร็จ'
  });
}

function handleSyncTaxInvoiceLinks(payload) {
  var rootFolderId = payload.rootFolderId;
  var invoiceFileId = payload.invoiceFileId;
  var invoiceNumber = payload.invoiceNumber || 'INVOICE';
  var matchAction = payload.matchAction;
  var bundles = payload.bundles;
  if (
    !rootFolderId ||
    !invoiceFileId ||
    matchAction !== 'revoke_match' ||
    !Array.isArray(bundles) ||
    bundles.length === 0 ||
    bundles.length > 50
  ) {
    return jsonResponse({ success: false, error: 'ข้อมูลทางลัดใบกำกับภาษีไม่ถูกต้อง' });
  }

  var root = DriveApp.getFolderById(rootFolderId);
  var zones = {
    ZONE_02: getOrCreateSubfolder(root, ZONE_NAMES.ZONE_02),
    ZONE_04: getOrCreateSubfolder(root, ZONE_NAMES.ZONE_04)
  };
  var taxZone = zones.ZONE_04;
  var taxFile = DriveApp.getFileById(invoiceFileId);
  var isInTaxZone = false;
  var parents = taxFile.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === taxZone.getId()) {
      isInTaxZone = true;
      break;
    }
  }
  if (!isInTaxZone) {
    return jsonResponse({ success: false, error: 'ต้นฉบับใบกำกับภาษีไม่ได้อยู่ในโฟลเดอร์ใบกำกับภาษี' });
  }

  var folders = [];
  var targetId = invoiceFileId;
  var shortcutMimeType = 'application/vnd.google-apps.shortcut';
  bundles.forEach(function(bundle) {
    var trNumber = String(bundle.trNumber || '').trim();
    var doNumber = String(bundle.doNumber || '').trim();
    if (!trNumber || !doNumber) {
      throw new Error('ต้องระบุเลข TR และเลข DO ของทุกทางลัด');
    }
    var bundleName = sanitizeDriveName(trNumber) + '_DO-' + sanitizeDriveName(doNumber);
    var targetFolder = getOrCreateSubfolder(zones.ZONE_02, bundleName);
    var matches = listDriveFolderFiles(targetFolder.getId()).filter(function(file) {
      return file.mimeType === shortcutMimeType &&
        file.shortcutDetails &&
        file.shortcutDetails.targetId === targetId;
    });

    if (matchAction === 'confirm_match') {
      if (matches.length === 0) {
        gasDriveApiRequest('post', 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,parents,shortcutDetails', {
          name: 'INV_' + sanitizeDriveName(invoiceNumber) + '.jpg',
          mimeType: shortcutMimeType,
          parents: [targetFolder.getId()],
          shortcutDetails: { targetId: targetId }
        });
      } else {
        matches.slice(1).forEach(function(duplicate) {
          gasDriveApiRequest('delete', 'https://www.googleapis.com/drive/v3/files/' +
            encodeURIComponent(duplicate.id) + '?supportsAllDrives=true');
        });
      }
    } else {
      matches.forEach(function(shortcut) {
        gasDriveApiRequest('delete', 'https://www.googleapis.com/drive/v3/files/' +
          encodeURIComponent(shortcut.id) + '?supportsAllDrives=true');
      });
    }
    folders.push({ trNumber: trNumber, folderId: targetFolder.getId() });
  });
  return jsonResponse({ success: true, folders: folders });
}

function listDriveFolderFiles(folderId) {
  var files = [];
  var pageToken = '';
  do {
    var query = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + query +
      '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
      '&fields=nextPageToken,files(id,name,mimeType,parents,shortcutDetails(targetId))';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    var result = gasDriveApiRequest('get', url);
    files = files.concat(result.files || []);
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return files;
}

function gasDriveApiRequest(method, url, payload) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Google Drive API HTTP ' + code + ': ' + text);
  }
  return text ? JSON.parse(text) : {};
}

// Rename a file and optionally move it to a target zone in one atomic call
function handleRenameAndMoveFile(payload) {
  var fileId       = payload.fileId;        // Drive file ID to rename+move
  var newFileName  = payload.newFileName;   // New filename including extension
  var rootFolderId = payload.rootFolderId;
  var targetZone   = payload.targetZone;    // 'zone_01' | 'zone_02' | 'zone_03' | 'zone_04'
  var subfolderName = payload.subfolderName; // optional sub-folder inside zone (e.g. TR-xxx_DO-xxx)
  var preserveOriginalName = payload.preserveOriginalName === true;
  var reorganizeExistingDo = payload.reorganizeExistingDo === true;
  var allowOriginTicketCorrection = payload.allowOriginTicketCorrection === true;

  if (!fileId || !newFileName) {
    return jsonResponse({ success: false, error: 'ระบุ fileId และ newFileName ไม่ครบ' });
  }

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    return jsonResponse({ success: false, error: 'ไม่พบไฟล์: ' + e.toString() });
  }
  var originalFileName = file.getName();

  // 2. Move (optional)
  if (rootFolderId && targetZone && ZONE_KEY_MAP[targetZone]) {
    try {
      var rootFolder = DriveApp.getFolderById(rootFolderId);
      if (reorganizeExistingDo && targetZone !== 'zone_02') {
        return jsonResponse({ success: false, error: 'จัดระเบียบย้อนหลังได้เฉพาะไฟล์ในโซน 02' });
      }
      if (reorganizeExistingDo) {
        var zone02Folder = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_02);
        var inboxFolder = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_00);
        var allowedSourceFolderIds = [inboxFolder.getId(), zone02Folder.getId()];
        if (allowOriginTicketCorrection) {
          ['ZONE_01', 'ZONE_03', 'ZONE_04'].forEach(function(zoneKey) {
            allowedSourceFolderIds.push(getOrCreateSubfolder(rootFolder, ZONE_NAMES[zoneKey]).getId());
          });
        }
        var parents = file.getParents();
        var allowedSource = false;
        while (parents.hasNext()) {
          var parent = parents.next();
          if (allowedSourceFolderIds.indexOf(parent.getId()) >= 0) {
            allowedSource = true;
            break;
          }
          var grandparents = parent.getParents();
          while (grandparents.hasNext()) {
            if (allowedSourceFolderIds.indexOf(grandparents.next().getId()) >= 0) {
              allowedSource = true;
              break;
            }
          }
          if (allowedSource) break;
        }
        if (!allowedSource) {
          return jsonResponse({ success: false, error: 'ไฟล์ไม่ได้อยู่ในโฟลเดอร์เอกสารมาตรฐานที่อนุญาต จึงหยุดก่อนย้าย' });
        }
      }
      var zoneName   = ZONE_NAMES[ZONE_KEY_MAP[targetZone]];
      var targetFolder = getOrCreateSubfolder(rootFolder, zoneName);
      if (subfolderName) {
        targetFolder = getOrCreateSubfolder(targetFolder, subfolderName);
      }
      if (!preserveOriginalName) file.setName(newFileName);
      file.moveTo(targetFolder);
      return jsonResponse({
        success: true,
        fileId: file.getId(),
        originalFileName: originalFileName,
        fileName: file.getName(),
        targetFolderId: targetFolder.getId(),
        message: preserveOriginalName ? 'ย้ายไฟล์เข้าโฟลเดอร์ใบงานสำเร็จ' : 'เปลี่ยนชื่อและย้ายไฟล์สำเร็จ'
      });
    } catch (e) {
      return jsonResponse({ success: false, error: 'จัดการไฟล์ใน Google Drive ไม่สำเร็จ: ' + e.toString() });
    }
  }

  if (!preserveOriginalName) file.setName(newFileName);
  return jsonResponse({
    success: true,
    fileId: file.getId(),
    originalFileName: originalFileName,
    fileName: file.getName(),
    message: 'เปลี่ยนชื่อไฟล์สำเร็จ (ไม่ได้ย้ายโฟลเดอร์)'
  });
}

function handleRestoreLineInboxFile(payload) {
  var rootFolderId = payload.rootFolderId;
  var fileId = payload.fileId;
  var originalFileName = String(payload.originalFileName || '').trim();
  if (!rootFolderId || !fileId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId และ fileId เพื่อคืนรูป' });
  }

  try {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var inboxFolder = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_00);
    var standardZoneIds = [
      getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_01).getId(),
      getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_02).getId(),
      getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_03).getId(),
      getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_04).getId()
    ];
    var zone02Id = standardZoneIds[1];
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    var inInbox = false;
    var inDoZone = false;

    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() === inboxFolder.getId()) {
        inInbox = true;
        break;
      }
      if (standardZoneIds.indexOf(parent.getId()) >= 0) {
        inDoZone = true;
        continue;
      }
      var grandparents = parent.getParents();
      while (grandparents.hasNext()) {
        if (grandparents.next().getId() === zone02Id) {
          inDoZone = true;
          break;
        }
      }
      if (inDoZone) break;
    }

    if (!inInbox && !inDoZone) {
      return jsonResponse({
        success: false,
        error: 'ไม่คืนรูป: ไฟล์ไม่ได้อยู่ใน LINE Inbox หรือโฟลเดอร์ชุด DO ที่อนุญาต'
      });
    }
    if (!inInbox) file.moveTo(inboxFolder);
    if (originalFileName && file.getName() !== originalFileName) {
      file.setName(originalFileName);
    }
    return jsonResponse({
      success: true,
      fileId: file.getId(),
      originalFileName: file.getName(),
      targetZone: 'zone_00',
      message: inInbox ? 'ไฟล์อยู่ใน LINE Inbox แล้ว' : 'คืนไฟล์เข้า LINE Inbox สำเร็จ'
    });
  } catch (e) {
    return jsonResponse({ success: false, error: 'คืนไฟล์เข้า LINE Inbox ไม่สำเร็จ: ' + e.toString() });
  }
}

function handleVerifyDoFileLocation(payload) {
  var rootFolderId = payload.rootFolderId;
  var fileId = payload.fileId;
  if (!rootFolderId || !fileId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId และ fileId เพื่อตรวจสอบไฟล์ DO' });
  }

  try {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var zone02Folder = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_02);
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    var pendingFolders = [];
    var checkedFolders = {};
    while (parents.hasNext()) {
      pendingFolders.push({ id: parents.next().getId(), depth: 1 });
    }

    while (pendingFolders.length) {
      var current = pendingFolders.shift();
      if (current.id === zone02Folder.getId()) {
        return jsonResponse({ success: true, fileId: fileId, driveFileLocation: 'zone_02' });
      }
      if (checkedFolders[current.id] || current.depth >= 10) {
        continue;
      }
      checkedFolders[current.id] = true;
      var currentFolder = DriveApp.getFolderById(current.id);
      var ancestors = currentFolder.getParents();
      while (ancestors.hasNext()) {
        pendingFolders.push({ id: ancestors.next().getId(), depth: current.depth + 1 });
      }
    }
    return jsonResponse({
      success: false,
      error: 'ตรวจแล้ว แต่ไฟล์ DO ไม่ได้อยู่ใต้โฟลเดอร์ zone 02',
      fileId: fileId,
      zone02FolderId: zone02Folder.getId(),
      checkedFolderIds: Object.keys(checkedFolders)
    });
  } catch (e) {
    return jsonResponse({ success: false, error: 'ตรวจสอบตำแหน่งไฟล์ DO ไม่สำเร็จ: ' + e.toString() });
  }
}

function handleCleanupEmptyDoFolder(payload) {
  var rootFolderId = String(payload.rootFolderId || '');
  var trNumber = String(payload.trNumber || '').trim();
  var doNumber = String(payload.doNumber || '').trim();
  if (!rootFolderId || !trNumber || !doNumber) {
    return jsonResponse({ success: false, error: 'ต้องระบุ Root Folder ID, เลข TR และเลข DO ก่อนลบโฟลเดอร์ว่าง' });
  }

  try {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var zone02Folders = rootFolder.getFoldersByName(ZONE_NAMES.ZONE_02);
    if (!zone02Folders.hasNext()) {
      return jsonResponse({ success: true, deleted: false, reason: 'zone_02_not_found' });
    }
    var zone02 = zone02Folders.next();
    if (zone02Folders.hasNext()) {
      return jsonResponse({ success: false, error: 'พบโฟลเดอร์ zone 02 ซ้ำ จึงไม่ลบโฟลเดอร์ใบงานเพื่อความปลอดภัย' });
    }

    var folderName = sanitizeDriveName(trNumber) + '_DO-' + sanitizeDriveName(doNumber);
    var folders = zone02.getFoldersByName(folderName);
    if (!folders.hasNext()) {
      return jsonResponse({ success: true, deleted: false, reason: 'bundle_folder_not_found' });
    }
    var folder = folders.next();
    if (folders.hasNext()) {
      return jsonResponse({ success: false, error: 'พบโฟลเดอร์ใบงานชื่อซ้ำ จึงไม่ลบเพื่อป้องกันข้อมูลผิดชุด' });
    }

    if (folder.getFiles().hasNext() || folder.getFolders().hasNext()) {
      return jsonResponse({
        success: false,
        error: 'โฟลเดอร์ใบงานยังมีไฟล์หรือโฟลเดอร์ย่อยอยู่ จึงไม่ลบเพื่อป้องกันข้อมูลสูญหาย',
        folderId: folder.getId(),
        folderName: folderName
      });
    }

    folder.setTrashed(true);
    return jsonResponse({
      success: true,
      deleted: true,
      folderId: folder.getId(),
      folderName: folderName
    });
  } catch (e) {
    return jsonResponse({ success: false, error: 'ลบโฟลเดอร์ใบงานว่างไม่สำเร็จ: ' + e.toString() });
  }
}

function handleCleanup(payload) {
  var fileId = payload.fileId;
  var folderId = payload.folderId;
  var rescueFileId = payload.rescueFileId;
  var rescueTargetFolderId = payload.rescueTargetFolderId;
  var rootFolderId = payload.rootFolderId;

  // Rescue Rule: กู้ตั๋วชั่งปลายทางกลับโฟลเดอร์ 03 ก่อนลบโฟลเดอร์ DO
  if (rescueFileId) {
    try {
      var rFile = DriveApp.getFileById(rescueFileId);
      var rTarget;
      if (rescueTargetFolderId) {
        rTarget = DriveApp.getFolderById(rescueTargetFolderId);
      } else if (rootFolderId) {
        var rootFolder = DriveApp.getFolderById(rootFolderId);
        rTarget = getOrCreateSubfolder(rootFolder, ZONE_NAMES.ZONE_03);
      }
      if (rTarget) {
        rFile.moveTo(rTarget);
      }
    } catch (e) {
      // ข้ามหากไฟล์เดิมไม่มีอยู่แล้ว
    }
  }

  if (fileId) {
    var file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
  }

  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      folder.setTrashed(true);
    } catch (e) {}
  }

  return jsonResponse({
    success: true,
    message: 'ทำความสะอาดไฟล์ขยะ (Zero-Junk Cleanup) สำเร็จ'
  });
}

function handleListZoneFiles(payload) {
  var rootFolderId = payload.rootFolderId;
  if (!rootFolderId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId' });
  }

  var root = DriveApp.getFolderById(rootFolderId);
  var zone00Folders = root.getFoldersByName(ZONE_NAMES.ZONE_00);
  if (!zone00Folders.hasNext()) {
    return jsonResponse({ success: true, files: [], totalCount: 0 });
  }

  var files = [];
  var iterator = zone00Folders.next().getFiles();
  var maxFiles = 2000;
  while (iterator.hasNext() && files.length < maxFiles) {
    var file = iterator.next();
    var fileId = file.getId();
    files.push({
      id: fileId,
      name: file.getName(),
      createdTime: file.getDateCreated().toISOString(),
      webViewLink: 'https://drive.google.com/file/d/' + fileId + '/view'
    });
  }

  return jsonResponse({
    success: true,
    files: files,
    totalCount: files.length,
    hasMore: iterator.hasNext()
  });
}

function handleQuarantineInboxFile(payload) {
  var rootFolderId = payload.rootFolderId;
  var fileId = payload.fileId;
  if (!rootFolderId || !fileId) {
    return jsonResponse({ success: false, error: 'กรุณาระบุ rootFolderId และ fileId' });
  }

  var root = DriveApp.getFolderById(rootFolderId);
  var zone00Folders = root.getFoldersByName(ZONE_NAMES.ZONE_00);
  var quarantineFolder = getOrCreateSubfolder(root, ZONE_NAMES.ZONE_99);
  if (!zone00Folders.hasNext()) {
    return jsonResponse({
      success: true,
      quarantined: false,
      message: 'ไม่พบโฟลเดอร์ 00 จึงข้ามการย้ายไฟล์; ลบเฉพาะรายการในกล่องพักได้'
    });
  }

  var zone00 = zone00Folders.next();
  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  var isInInboxZone = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === zone00.getId()) {
      isInInboxZone = true;
      break;
    }
  }
  if (!isInInboxZone) {
    return jsonResponse({
      success: true,
      quarantined: false,
      message: 'ไฟล์ไม่ได้อยู่ในโฟลเดอร์ 00 จึงข้ามการย้ายไฟล์; ลบเฉพาะรายการในกล่องพักได้'
    });
  }

  file.moveTo(quarantineFolder);
  return jsonResponse({
    success: true,
    fileId: fileId,
    quarantineFolder: ZONE_NAMES.ZONE_99
  });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
