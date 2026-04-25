/**
 * メルカリ出品管理アプリ - Google Apps Script サーバー側処理
 *
 * 機能:
 *   1. 写真アップロード → Google Drive「メルカリ/{商品名}/」に保存
 *   2. ダッシュボード → Googleスプレッドシートから出品・利益データを取得
 *
 * セットアップ手順:
 *   1. Google Drive に「メルカリ出品管理」スプレッドシートを新規作成
 *   2. URLから ID をコピーして SPREADSHEET_ID に設定
 *   3. スプレッドシートに「出品管理」シートを作成し、1行目にヘッダーを入力:
 *      商品名 | 出品日 | 出品価格 | 仕入原価 | 送料 | 手数料 | 利益 | 利益率 | 発送方法 | ステータス
 *   4. デプロイ → ウェブアプリ → 「自分のみ」でアクセス → URLをスマホに登録
 */

// ── 設定 ──

const SPREADSHEET_ID = "1wSKYRcDtkPVZA-hu4INcx2SktSDG4_s9O5GKLTCyB4o"; // メルカリ出品管理
const SHEET_NAME = "出品管理";
const ROOT_FOLDER_NAME = "メルカリ";


// ── ルーティング ──

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "index";
  // テストページ: ?page=test で入力テストを実行可能
  if (page === "test") {
    return HtmlService.createHtmlOutputFromFile("test_input")
      .setTitle("入力テスト");
  }
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("メルカリ出品管理");
}


// ── 写真アップロード ──

/**
 * スマホから送られた写真を Google Drive に保存する
 *
 * @param {string} productName - 商品名（フォルダ名に使用）
 * @param {Array}  photos      - [{name, mimeType, data(base64)}, ...]
 * @returns {Object} 保存結果
 */
function uploadPhotos(productName, photos) {
  if (!productName || productName.trim() === "") {
    return { success: false, error: "商品名を入力してください" };
  }
  if (!photos || photos.length === 0) {
    return { success: false, error: "写真が選択されていません" };
  }

  try {
    // ルートフォルダ取得または作成
    const rootFolder = getOrCreateFolder_(null, ROOT_FOLDER_NAME);

    // 商品フォルダ取得または作成
    const productFolder = getOrCreateFolder_(rootFolder, productName.trim());

    // 写真を順番に保存
    const savedFiles = [];
    const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");

    photos.forEach(function(photo, i) {
      const fileName = photo.name || (timestamp + "_" + (i + 1) + ".jpg");
      const decodedData = Utilities.base64Decode(photo.data);
      const blob = Utilities.newBlob(decodedData, photo.mimeType, fileName);
      const file = productFolder.createFile(blob);

      savedFiles.push({
        name: file.getName(),
        id: file.getId()
      });
    });

    return {
      success: true,
      productName: productName.trim(),
      folderId: productFolder.getId(),
      savedCount: savedFiles.length,
      files: savedFiles,
      message: savedFiles.length + "枚の写真を保存しました"
    };

  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * フォルダを取得または作成する（内部ユーティリティ）
 */
function getOrCreateFolder_(parentFolder, folderName) {
  const iterator = parentFolder
    ? parentFolder.getFoldersByName(folderName)
    : DriveApp.getFoldersByName(folderName);

  if (iterator.hasNext()) {
    return iterator.next();
  }

  return parentFolder
    ? parentFolder.createFolder(folderName)
    : DriveApp.createFolder(folderName);
}


// ── ダッシュボードデータ取得 ──

/**
 * スプレッドシートから出品データを取得してダッシュボード用に返す
 *
 * @returns {Object} { listings: [...], total_listed, total_sold, total_profit }
 */
function getDashboardData() {
  if (SPREADSHEET_ID === "YOUR_SPREADSHEET_ID_HERE") {
    return {
      error: "SPREADSHEET_ID が未設定です。mercari_uploader.gs を編集してください。",
      listings: []
    };
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);

    // シートが存在しない場合は作成
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const headers = ["商品名", "出品日", "出品価格", "仕入原価", "送料",
                       "手数料", "利益", "利益率", "発送方法", "ステータス"];
      sheet.appendRow(headers);
      return { listings: [], total_listed: 0, total_sold: 0, total_profit: 0 };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { listings: [], total_listed: 0, total_sold: 0, total_profit: 0 };
    }

    const headers = data[0];
    const rows = data.slice(1)
      .map(function(row) {
        const obj = {};
        headers.forEach(function(h, i) { obj[h] = row[i]; });
        return obj;
      })
      .filter(function(r) { return r["商品名"] && r["商品名"] !== ""; });

    // 集計
    const totalListed  = rows.filter(function(r) { return r["ステータス"] === "出品中"; }).length;
    const totalSold    = rows.filter(function(r) {
      return ["売約済み", "発送済み", "完了"].indexOf(r["ステータス"]) >= 0;
    }).length;
    const totalProfit  = rows.reduce(function(sum, r) {
      return sum + (parseInt(r["利益"]) || 0);
    }, 0);

    return {
      listings: rows.reverse(), // 新しい順
      total_listed: totalListed,
      total_sold: totalSold,
      total_profit: totalProfit
    };

  } catch (err) {
    return { error: err.toString(), listings: [] };
  }
}
