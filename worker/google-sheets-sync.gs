const SPREADSHEET_ID = '1O1zClgJ3qL-88TpwyV2cKxUhVSu6e4UFayfH4kDz0U4';

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'contentmanagement-sheets-sync' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.secret !== PropertiesService.getScriptProperties().getProperty('SYNC_SECRET')) {
      return jsonOut({ ok: false, error: 'unauthorized' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tables = payload.tables || {};

    Object.keys(tables).forEach(function(name) {
      const rows = Array.isArray(tables[name]) ? tables[name] : [];
      const safeName = String(name).slice(0, 80);
      const sheet = ss.getSheetByName(safeName) || ss.insertSheet(safeName);
      sheet.clearContents();

      if (!rows.length) {
        sheet.getRange(1, 1).setValue('No data');
        return;
      }

      const headers = [];
      rows.forEach(function(row) {
        Object.keys(row || {}).forEach(function(key) {
          if (headers.indexOf(key) === -1) headers.push(key);
        });
      });

      const values = [headers];
      rows.forEach(function(row) {
        values.push(headers.map(function(key) {
          const value = row && row[key];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return value;
        }));
      });

      sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    });

    return jsonOut({ ok: true, synced: Object.keys(tables) });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
