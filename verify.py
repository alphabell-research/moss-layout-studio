"""Exercise the actual browser editor, with no model inference."""
import argparse
import functools
import http.server
import json
import re
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url')
    parser.add_argument('--artifacts', type=Path)
    args = parser.parse_args()
    server = None
    if args.base_url:
        base_url = args.base_url.rstrip('/') + '/'
    else:
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *unused):
                pass
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base_url = f'http://127.0.0.1:{server.server_port}/'
    checks = []
    errors = []
    requests = []
    try:
        with sync_playwright() as p:
            launch_options = {'headless': True, 'args': ['--no-sandbox']}
            if Path('/usr/bin/chromium').is_file():
                launch_options['executable_path'] = '/usr/bin/chromium'
            browser = p.chromium.launch(**launch_options)
            try:
                context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce', accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: requests.append(request.url))
                page.goto(base_url, wait_until='networkidle')
                page.wait_for_function('() => document.getElementById("json-output").value.startsWith("{")')

                def output():
                    return json.loads(page.locator('#json-output').input_value())

                def tab(name):
                    page.locator('#tab-' + name).click()

                def check(name):
                    checks.append(name)

                first = output()
                assert first['bbox_coord_space'] == 'abs_centralized'
                assert first['bbox_format'] == 'yxyx'
                assert 'width' not in first and 'height' not in first
                assert first['items'][0]['bbox'] == [-416, -384, -288, 384]
                assert first['items'][2]['text'] == 'まだ見ぬ場所へ'
                check('initial compiled layout and centered coordinates')

                for example in ['poster', 'cup', 'type']:
                    page.locator(f'[data-example="{example}"]').click()
                    compiled = output()
                    assert compiled['items'] and all(item['label'] in ['text', 'object', 'character'] for item in compiled['items'])
                    assert all('id' not in item for item in compiled['items'])
                    tab('draft')
                    draft = output()
                    assert draft['width'] % 16 == draft['height'] % 16 == 0
                    assert draft['bbox_coord_space'] == 'abs' and draft['bbox_format'] == 'xyxy'
                    if example == 'cup':
                        assert compiled['items'][0]['bbox'] == [-288, -592, 352, 32]
                        assert draft['items'][1]['text'] == '把日常，过成诗。'
                        assert draft['items'][2]['text'] == '一杯温暖\n一刻从容'
                    with tempfile.TemporaryDirectory() as directory:
                        path = Path(directory) / 'draft.json'
                        path.write_text(json.dumps(draft, ensure_ascii=False))
                        page.locator('#import').set_input_files(path)
                        page.wait_for_function('() => document.getElementById("status").textContent.startsWith("Layout imported")')
                        assert output() == draft
                    tab('prompt')
                    assert output() == compiled
                check('all three presets and exact editable JSON round trips')

                page.locator('[data-example="poster"]').click()
                box = page.locator('.layout-box').first
                box.focus()
                box.press('ArrowRight')
                assert page.locator('#box-x').input_value() == '129'
                box.press('Shift+ArrowDown')
                assert page.locator('#box-y').input_value() == '106'
                box.press('Alt+ArrowRight')
                assert page.locator('#box-w').input_value() == '769'
                page.locator('#undo').click()
                assert page.locator('#box-w').input_value() == '768'
                page.locator('#redo').click()
                assert page.locator('#box-w').input_value() == '769'
                box = page.locator('.layout-box').nth(1)
                box.focus()
                assert box.get_attribute('aria-pressed') == 'true'
                assert page.locator('.layout-box[aria-pressed=true]').count() == 1
                check('keyboard movement, resizing, focus selection, undo and redo')

                page.locator('[data-example="poster"]').click()
                box = page.locator('.layout-box').first
                rect = box.bounding_box()
                page.mouse.move(rect['x'] + rect['width'] / 2, rect['y'] + rect['height'] / 2)
                page.mouse.down()
                page.mouse.move(rect['x'] + rect['width'] / 2 + 22, rect['y'] + rect['height'] / 2 + 12, steps=4)
                page.mouse.up()
                assert float(page.locator('#box-x').input_value()) > 128
                handle = page.locator('.layout-box').first.locator('.resize-handle').bounding_box()
                old_w = float(page.locator('#box-w').input_value())
                page.mouse.move(handle['x'] + handle['width'] / 2, handle['y'] + handle['height'] / 2)
                page.mouse.down()
                page.mouse.move(handle['x'] + handle['width'] / 2 - 18, handle['y'] + handle['height'] / 2 + 10, steps=3)
                page.mouse.up()
                assert float(page.locator('#box-w').input_value()) < old_w
                check('pointer dragging and corner resizing')

                before_x = page.locator('#box-x').input_value()
                page.locator('#box-x').fill('999999')
                page.locator('#box-x').press('Tab')
                assert page.locator('#box-x').input_value() == before_x
                assert 'inside the canvas' in page.locator('#status').inner_text()
                page.locator('#scene-caption').fill('')
                page.locator('#scene-caption').press('Tab')
                assert page.locator('#copy').is_disabled() and page.locator('#download').is_disabled()
                page.locator('#scene-caption').fill('A test composition with exact words.')
                page.locator('#scene-caption').press('Tab')
                assert page.locator('#copy').is_enabled()
                check('invalid geometry rejected and incomplete export disabled')

                page.locator('[data-example="poster"]').click()
                page.locator('#canvas-width').fill('1536')
                page.locator('#apply-size').click()
                assert page.locator('#box-x').input_value() == '192'
                assert page.locator('#box-w').input_value() == '1152'
                page.locator('#scale-boxes').uncheck()
                page.locator('#canvas-width').fill('1024')
                page.locator('#apply-size').click()
                assert 'fall outside' in page.locator('#status').inner_text()
                assert page.locator('#canvas-readout').inner_text() == '1536 × 1024 px'
                page.locator('#canvas-width').fill('2048')
                page.locator('#apply-size').click()
                assert page.locator('#box-x').input_value() == '192'
                assert page.locator('#box-w').input_value() == '1152'
                page.locator('#scale-boxes').check()
                check('explicit proportional resize and preserved pixel positions')

                page.locator('[data-example="cup"]').click()
                tab('draft')
                expected = page.locator('#json-output').input_value() + '\n'
                with page.expect_download() as event:
                    page.locator('#download').click()
                download = event.value
                assert download.suggested_filename == 'moss-draft-1536x1024.json'
                assert Path(download.path()).read_text() == expected
                page.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(new Error("denied"))}})')
                page.locator('#copy').click()
                assert 'JSON is selected' in page.locator('#status').inner_text()
                assert page.locator('#json-output').evaluate('(el)=>el.selectionEnd-el.selectionStart') == len(expected.rstrip('\n'))
                check('exact Unicode download and clipboard denial fallback')

                safe = output()
                safe['summary']['palette'] = ['ivory', 'green']
                safe['summary']['meta'] = ['print, editorial', 'studio\nphotography']
                safe['items'][0]['tags'] = ['ceramic', 'handmade']
                safe['items'][0]['palette'] = ['ivory']
                safe['items'][1]['text'] = '<img src=x onerror="window.xss=1">\nمرحبا 🌿'
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / 'draft.json'
                    path.write_text(json.dumps(safe, ensure_ascii=False))
                    page.locator('#import').set_input_files(path)
                    page.wait_for_function('() => document.getElementById("status").textContent.startsWith("Layout imported")')
                    assert output() == safe
                    assert page.locator('#stage img').count() == 0
                    assert page.evaluate('window.xss') is None
                    assert '<img' in page.locator('.layout-box.text').first.inner_text()
                    page.locator('#scene-meta').fill('new, exact tag')
                    page.locator('#scene-meta').press('Enter')
                    safe['summary']['meta'].append('new, exact tag')
                    assert output() == safe
                    path.write_text(json.dumps({**safe, 'unexpected': True}))
                    page.locator('#import').set_input_files(path)
                    page.wait_for_function('() => document.getElementById("status").textContent.startsWith("Import failed")')
                    assert output() == safe
                    path.write_text('{"width":1024,"width":2048}')
                    page.locator('#import').set_input_files(path)
                    expect(page.locator('#status')).to_contain_text(re.compile('duplicate', re.I))
                check('strict imports, optional fields preserved, literal HTML cannot execute')

                page.locator('#add-character').click()
                assert page.locator('#item-label').input_value() == 'character'
                count = page.locator('.layout-box').count()
                page.locator('#duplicate').click()
                assert page.locator('.layout-box').count() == count + 1
                page.locator('#delete').click()
                assert page.locator('.layout-box').count() == count
                page.locator('#undo').click()
                assert page.locator('.layout-box').count() == count + 1
                check('add, duplicate, remove and restore elements')

                page.locator('[data-example="poster"]').click()
                tab('prompt')
                if args.artifacts:
                    args.artifacts.mkdir(parents=True, exist_ok=True)
                    page.evaluate('document.activeElement?.blur(); document.getElementById("json-output").scrollTop=0; window.scrollTo(0,0)')
                    page.screenshot(path=str(args.artifacts / 'moss-desktop.png'), full_page=True)

                mobile = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True, reduced_motion='reduce')
                phone = mobile.new_page()
                phone.on('pageerror', lambda error: errors.append(str(error)))
                phone.on('request', lambda request: requests.append(request.url))
                phone.goto(base_url, wait_until='networkidle')
                phone.wait_for_function('() => document.getElementById("json-output").value.startsWith("{")')
                assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                phone.locator('.layout-box').first.scroll_into_view_if_needed()
                r = phone.locator('.layout-box').first.bounding_box()
                cdp = mobile.new_cdp_session(phone)
                x, y = r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + 14, 'y': y + 12}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                assert float(phone.locator('#box-x').input_value()) > 128
                phone.locator('.layout-box').first.scroll_into_view_if_needed()
                r = phone.locator('.layout-box').first.locator('.resize-handle').bounding_box()
                old_w = float(phone.locator('#box-w').input_value())
                x, y = r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x - 15, 'y': y + 10}]})
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                assert float(phone.locator('#box-w').input_value()) < old_w
                assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                phone.locator('[data-example="type"]').click()
                phone.locator('.layout-box').first.scroll_into_view_if_needed()
                board = phone.locator('#stage').bounding_box()
                assert abs(board['width'] / board['height'] - 1024 / 1280) < .01
                check('mobile layout, actual touch drag and resize, portrait aspect ratio')
                if args.artifacts:
                    phone.evaluate('document.activeElement?.blur(); document.getElementById("json-output").scrollTop=0; window.scrollTo(0,0)')
                    phone.screenshot(path=str(args.artifacts / 'moss-phone.png'), full_page=True)
                mobile.close()
                allowed_origin = '/'.join(base_url.split('/')[:3])
                foreign = [url for url in requests if not url.startswith(allowed_origin + '/') and not url.startswith('blob:') and not url.startswith('data:')]
                assert not foreign, foreign
                assert not errors, errors
                check('no external network requests or browser runtime errors')
                context.close()
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
    print(json.dumps({'passed': len(checks), 'checks': checks, 'runtime_errors': errors, 'base_url': args.base_url or 'local'}, indent=2))


if __name__ == '__main__':
    main()
