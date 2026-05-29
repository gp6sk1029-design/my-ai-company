"""
EC販売部門 - メルカリ自動出品（Selenium版）
ダッシュボードの「自動出品」ボタンから呼ばれ、
Seleniumで Chrome を操作してメルカリに出品する。

前提:
  - Chrome でメルカリにログイン済みのプロファイルを使用
  - Google Drive に商品写真がアップロード済み

安全対策:
  - 1日10件上限
  - 各操作間に3〜8秒のランダム遅延
  - 出品ログ記録
"""

import os
import sys
import json
import time
import random
import glob
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
QUEUE_PATH = os.path.join(BASE_DIR, "data", "listing_queue.json")
PHOTO_TEMP_DIR = os.path.join(BASE_DIR, "data", "temp_photos")


def random_delay(min_sec=3, max_sec=8):
    """ランダム遅延"""
    delay = random.uniform(min_sec, max_sec)
    time.sleep(delay)


def download_photos_from_drive(product_name):
    """Google Drive から写真をダウンロードしてローカルパスを返す"""
    from google_drive import get_drive_service, get_root_folder_id, list_product_folders, list_photos_in_folder

    service = get_drive_service()
    root_id = get_root_folder_id(service)
    if not root_id:
        return []

    folders = list_product_folders(service, root_id)
    target = None
    for f in folders:
        if f["name"] == product_name:
            target = f
            break

    if not target:
        print(f"  ⚠️ Driveにフォルダ「{product_name}」が見つかりません")
        return []

    photos = list_photos_in_folder(service, target["id"])
    if not photos:
        return []

    # 一時フォルダにダウンロード
    temp_dir = os.path.join(PHOTO_TEMP_DIR, product_name.replace("/", "_"))
    os.makedirs(temp_dir, exist_ok=True)

    local_paths = []
    for photo in photos[:10]:  # 最大10枚
        from googleapiclient.http import MediaIoBaseDownload
        import io
        request = service.files().get_media(fileId=photo["id"])
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        local_path = os.path.join(temp_dir, photo["name"])
        with open(local_path, "wb") as f:
            f.write(fh.getvalue())
        local_paths.append(local_path)

    print(f"  📷 {len(local_paths)}枚の写真をダウンロード")
    return local_paths


def get_chrome_profile_dir():
    """Chrome のデフォルトプロファイルディレクトリを返す"""
    home = os.path.expanduser("~")
    return os.path.join(home, "Library", "Application Support", "Google", "Chrome")


DEBUG_PORT = 9222


def start_debug_chrome():
    """デバッグポート付きでChromeを起動する（初回のみ）"""
    import subprocess

    # 既にデバッグChromeが起動しているか確認
    import urllib.request
    try:
        req = urllib.request.urlopen(f"http://localhost:{DEBUG_PORT}/json/version", timeout=2)
        print("  ✅ デバッグChrome は既に起動中")
        return True
    except:
        pass

    print("  🌐 Chrome をデバッグモードで起動中...")
    chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    profile_dir = os.path.join(BASE_DIR, "data", "mercari_chrome")
    os.makedirs(profile_dir, exist_ok=True)

    subprocess.Popen([
        chrome_path,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--lang=ja",
        "--window-size=1200,900",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    return True


def create_driver():
    """既に起動中のデバッグChromeに接続する"""
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    start_debug_chrome()
    time.sleep(3)

    options = Options()
    options.add_experimental_option("debuggerAddress", f"localhost:{DEBUG_PORT}")

    driver = webdriver.Chrome(options=options)

    # ウィンドウが無ければ新規タブを開く
    try:
        _ = driver.current_url
    except:
        driver.execute_script("window.open('about:blank')")
        driver.switch_to.window(driver.window_handles[-1])

    return driver


def ensure_mercari_login(driver):
    """メルカリにログインしているか確認し、未ログインならログインページを表示して待つ"""
    driver.get("https://jp.mercari.com/mypage")
    time.sleep(4)

    if "login" in driver.current_url or "signup" in driver.current_url:
        print("\n  ⚠️ メルカリにログインが必要です！")
        print("  → 開いたChromeウィンドウで手動ログインしてください")
        print("  → ログインが完了したら自動で続行します")
        print("  （最大5分間待機します）\n")

        for i in range(60):
            time.sleep(5)
            try:
                current = driver.current_url
                if "mypage" in current and "login" not in current:
                    print("  ✅ ログイン確認OK！")
                    return True
            except:
                pass
            if i % 12 == 0 and i > 0:
                print(f"  ⏳ ログイン待機中... ({i*5}秒経過)")

        print("  ❌ ログインがタイムアウトしました")
        return False
    else:
        print("  ✅ メルカリにログイン済み")
        return True


def set_react_value(driver, selector, value, is_textarea=False):
    """React対応でフォーム値を設定する"""
    element_type = "HTMLTextAreaElement" if is_textarea else "HTMLInputElement"
    escaped_value = value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    driver.execute_script(f"""
        var el = document.querySelector('{selector}');
        if (!el) return;
        el.scrollIntoView({{block:'center'}});
        var setter = Object.getOwnPropertyDescriptor(window.{element_type}.prototype, 'value').set;
        setter.call(el, `{escaped_value}`);
        el.dispatchEvent(new Event('input', {{bubbles: true}}));
        el.dispatchEvent(new Event('change', {{bubbles: true}}));
    """)


def set_select_value(driver, select_index, value_text):
    """selectタグの値を設定する（インデックスでselect要素を指定）"""
    driver.execute_script(f"""
        var selects = document.querySelectorAll('select');
        var el = selects[{select_index}];
        if (!el) return;
        el.scrollIntoView({{block:'center'}});
        for (var i = 0; i < el.options.length; i++) {{
            if (el.options[i].text.includes('{value_text}')) {{
                el.selectedIndex = i;
                el.dispatchEvent(new Event('change', {{bubbles: true}}));
                break;
            }}
        }}
    """)


def click_and_select(driver, testid, option_text):
    """data-testid要素をクリックして、表示されたオプションから選択する"""
    from selenium.webdriver.common.by import By
    try:
        el = driver.find_element(By.CSS_SELECTOR, f'[data-testid="{testid}"]')
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        random_delay(0.5, 1)
        el.click()
        random_delay(1, 2)

        # オプションリストから選択
        options = driver.find_elements(By.CSS_SELECTOR, '[role="option"], [role="menuitem"], li, [class*="option"], [class*="select"]')
        for opt in options:
            if option_text in opt.text:
                opt.click()
                random_delay(0.5, 1)
                return True

        # フォールバック: テキストで探す
        all_elements = driver.find_elements(By.XPATH, f"//*[contains(text(), '{option_text}')]")
        for el in all_elements:
            if el.is_displayed():
                el.click()
                random_delay(0.5, 1)
                return True
    except Exception as e:
        print(f"    選択エラー ({testid}): {e}")
    return False


def post_to_mercari(driver, product_name, price, description, photo_paths,
                    condition="目立った傷や汚れなし", region="大阪府"):
    """
    メルカリに商品を出品する。
    AIウィザードに任せてカテゴリー・状態を自動設定 → タイトル等を上書き → 出品。
    """
    from selenium.webdriver.common.by import By

    title = product_name[:40]

    # ═══ STEP 1: フォームを開いて写真アップロード ═══
    print(f"\n  🌐 メルカリ出品フォームに移動...")
    driver.get("https://jp.mercari.com/sell/create")
    random_delay(4, 6)

    # ═══ STEP 2: 写真アップロード ═══
    print(f"  📷 写真をアップロード中...")
    try:
        file_input = driver.find_element(By.CSS_SELECTOR, 'input[data-testid="photo-upload"]')
        for path in photo_paths:
            file_input.send_keys(os.path.abspath(path))
            time.sleep(2)
        print(f"  ✅ 写真 {len(photo_paths)}枚アップロード完了")
    except Exception as e:
        print(f"  ⚠️ 写真エラー: {e}")

    # ═══ STEP 3: AIウィザードを「次へ」連打で通過 ═══
    print(f"  🤖 AIウィザード通過中（最大60秒）...")
    time.sleep(8)
    for attempt in range(15):
        time.sleep(3)
        url = driver.current_url
        # フォームに戻ってモーダルもなければ完了
        if "/sell/create" in url:
            # モーダルやウィザードが開いているか確認（「次へ」ボタンがあればまだウィザード中）
            has_wizard = driver.execute_script("""
                var btns = document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    var t = btns[i].textContent.trim();
                    if ((t === '次へ' || t === 'スキップ') && btns[i].offsetParent !== null) {
                        // 出品フォームの「出品する」ボタンも表示されていればウィザード終了
                        var submitBtn = document.querySelector('[data-testid="list-item-button"]');
                        if (submitBtn && submitBtn.offsetParent !== null) {
                            // フォーム上に「次へ」と「出品する」が両方ある → ウィザード終了
                            return false;
                        }
                        return true;
                    }
                }
                return false;
            """)
            if not has_wizard:
                # カテゴリーが設定されているか確認
                cat_text = driver.find_element(By.CSS_SELECTOR, '[data-testid="category-link"]').text
                if "選択する" not in cat_text:
                    print(f"  ✅ フォーム到達（カテゴリー設定済み）")
                    break
                elif attempt > 10:
                    print(f"  ⚠️ フォーム到達（カテゴリー未設定のまま）")
                    break
        # 各種ボタンをJSでクリック（overlay対策）
        # まずウィザード内の選択肢（カテゴリー・状態）があればクリック
        driver.execute_script("""
            // カテゴリー・状態の選択肢の最初のものをクリック
            var chips = document.querySelectorAll('[class*="chip"], [class*="Chip"], [class*="tag"], [class*="Tag"], [class*="option"], [class*="Option"]');
            for (var i = 0; i < chips.length; i++) {
                var t = chips[i].textContent.trim();
                if (t && t.length < 25 && chips[i].offsetParent !== null && t !== 'スキップ' && t !== '次へ' && t !== '戻る') {
                    chips[i].click();
                    break;
                }
            }
            // 「他のカテゴリーを選択する」以外のリンクをクリック
            var wizLinks = document.querySelectorAll('a, button');
            for (var i = 0; i < wizLinks.length; i++) {
                var t = wizLinks[i].textContent.trim();
                if (t && t.length < 20 && wizLinks[i].offsetParent !== null) {
                    if (t.includes('本体') || t.includes('その他') || t.includes('目立った') || t.includes('未使用')) {
                        wizLinks[i].click();
                        break;
                    }
                }
            }
        """)
        time.sleep(1)

        # 次に「次へ」をクリック
        result = driver.execute_script("""
            var actions = ['次へ','出品画面で編集する','編集する','確認する','完了'];
            var btns = document.querySelectorAll('button, a, span, p');
            for (var i = 0; i < btns.length; i++) {
                var t = btns[i].textContent.trim();
                for (var j = 0; j < actions.length; j++) {
                    if (t === actions[j] && btns[i].offsetParent !== null) {
                        btns[i].click();
                        return actions[j];
                    }
                }
            }
            return null;
        """)
        if result:
            print(f"    → 「{result}」")

    # モーダル残骸を削除
    driver.execute_script("""
        document.querySelectorAll('[data-testid="merModalBaseScrim"], [role="dialog"]').forEach(e=>e.remove());
        document.body.style.overflow='auto';
    """)
    time.sleep(2)

    # ═══ STEP 4: フォーム値を上書き（AIが入れた値を自分の値で上書き） ═══
    print(f"  ✏️ タイトル上書き: {title}")
    try:
        el = driver.find_element(By.CSS_SELECTOR, 'input[name="name"]')
        el.click()
        time.sleep(0.5)
        # 全選択して削除 → 新しい値を入力
        from selenium.webdriver.common.keys import Keys
        el.send_keys(Keys.COMMAND, 'a')
        time.sleep(0.3)
        el.send_keys(Keys.DELETE)
        time.sleep(0.3)
        el.send_keys(title)
        random_delay(1, 2)
        print(f"  ✅ タイトル完了")
    except Exception as e:
        print(f"  ⚠️ タイトル: {e}")

    print(f"  📝 説明文上書き...")
    try:
        el = driver.find_element(By.CSS_SELECTOR, 'textarea[name="description"]')
        el.click()
        time.sleep(0.5)
        el.send_keys(Keys.COMMAND, 'a')
        time.sleep(0.3)
        el.send_keys(Keys.DELETE)
        time.sleep(0.3)
        el.send_keys(description)
        random_delay(1, 2)
        print(f"  ✅ 説明文完了")
    except Exception as e:
        print(f"  ⚠️ 説明文: {e}")

    # ═══ STEP 5: 配送設定 ═══
    print(f"  📦 配送設定...")
    try:
        set_select_value(driver, 0, "送料込み")
        set_select_value(driver, 1, region)
        set_select_value(driver, 2, "2~3日")
        random_delay(1, 2)
        print(f"  ✅ 配送設定完了（送料込み/{region}/2~3日）")
    except Exception as e:
        print(f"  ⚠️ 配送設定: {e}")

    # ═══ STEP 6: 価格入力 ═══
    print(f"  💰 価格: ¥{price:,}")
    try:
        set_react_value(driver, 'input[data-testid="price-text-input"]', str(price))
        random_delay(1, 2)
        print(f"  ✅ 価格完了")
    except Exception as e:
        print(f"  ⚠️ 価格: {e}")

    # ═══ STEP 7: 検証 + スクリーンショット ═══
    random_delay(2, 3)
    try:
        name_val = driver.find_element(By.CSS_SELECTOR, 'input[name="name"]').get_attribute("value")
        cat_val = driver.find_element(By.CSS_SELECTOR, '[data-testid="category-link"]').text.strip()[:30]
        cond_val = driver.find_element(By.CSS_SELECTOR, '[data-testid="item-condition"]').text.strip()[:30]
        print(f"  検証: 名前=[{name_val}] カテゴリ=[{cat_val}] 状態=[{cond_val}]")
        if not name_val:
            el = driver.find_element(By.CSS_SELECTOR, 'input[name="name"]')
            el.click(); el.clear(); time.sleep(0.5); el.send_keys(title)
    except: pass
    driver.save_screenshot("/tmp/mercari_before_submit.png")
    print(f"  📸 出品前スクリーンショット保存")

    # ═══ STEP 8: 出品する ═══
    print(f"  🚀 「出品する」ボタンをクリック...")
    random_delay(2, 4)
    try:
        submit_btn = driver.find_element(By.CSS_SELECTOR, 'button[data-testid="list-item-button"]')
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", submit_btn)
        random_delay(1, 2)
        driver.execute_script("arguments[0].click();", submit_btn)
        random_delay(5, 8)
        driver.save_screenshot("/tmp/mercari_after_submit.png")
        final_url = driver.current_url
        print(f"  📸 出品後スクリーンショット保存")
        print(f"  最終URL: {final_url}")
        if "/sell/create" not in final_url:
            print(f"  ✅ 出品成功！")
            return True
        else:
            print(f"  ⚠️ バリデーションエラーの可能性")
            return False
    except Exception as e:
        print(f"  ⚠️ 出品ボタン: {e}")
        return False


def process_queue():
    """出品キューを処理する"""
    # キュー読み込み
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            queue = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        print("📭 出品キューが空です")
        return

    pending = [q for q in queue if q.get("status") == "pending"]
    if not pending:
        print("📭 未処理の商品はありません")
        return

    # 日次上限チェック
    from mercari_browser import can_list_today, record_listing
    can_list, count, limit = can_list_today()
    print(f"\n📦 出品キュー: {len(pending)}件")
    print(f"📊 本日の出品: {count}/{limit}件")

    if not can_list:
        print(f"⚠️ 本日の上限（{limit}件）に達しています")
        return

    # ドライバー作成
    print("\n🌐 Chrome を起動中...")
    driver = None
    try:
        driver = create_driver()
        print("✅ Chrome 起動完了")

        # ログイン確認（初回のみログインが必要）
        if not ensure_mercari_login(driver):
            print("❌ ログインできませんでした。中止します。")
            return

        for i, item in enumerate(pending):
            if not can_list_today()[0]:
                print(f"\n⚠️ 上限に達しました")
                break

            product_name = item.get("product_name", "")
            price = item.get("price", 0)
            description = item.get("description", "")

            print(f"\n{'='*50}")
            print(f"📦 [{i+1}/{len(pending)}] {product_name}")
            print(f"💰 ¥{price:,}")
            print(f"{'='*50}")

            # 写真ダウンロード
            photo_paths = download_photos_from_drive(product_name)

            # メルカリに出品
            success = post_to_mercari(driver, product_name, price, description, photo_paths)

            # ステータス更新
            item["status"] = "completed" if success else "failed"
            item["processed_at"] = datetime.now().isoformat()

            if success:
                record_listing()

            # キュー保存
            with open(QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(queue, f, ensure_ascii=False, indent=2)

            if i < len(pending) - 1:
                print(f"\n⏳ 次の商品まで待機中...")
                random_delay(5, 15)

    except Exception as e:
        print(f"\n❌ エラー: {e}")
    finally:
        # デバッグChromeは閉じない（ログイン状態を維持）
        print("\n💡 Chrome は開いたままです（次回もログイン不要）")

    print(f"\n🎉 出品処理完了！")


if __name__ == "__main__":
    process_queue()
