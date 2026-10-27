"""Exercise the browser-only blind layout evaluator with local PNG fixtures."""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url')
    args = parser.parse_args()
    server = None
    if args.base_url:
        base = args.base_url.rstrip('/') + '/'
    else:
        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *unused):
                pass
        server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT))
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/'
    checks = []
    failures = []
    requests = []
    draft = {
        'width': 400, 'height': 240, 'bbox_coord_space': 'abs', 'bbox_format': 'xyxy',
        'summary': {'caption': 'A title card'},
        'items': [{'label': 'text', 'caption': 'White title', 'text': 'HELLO', 'bbox': [40, 40, 190, 85]}],
    }
    compiled = {
        'summary': draft['summary'],
        'items': [{'label': 'text', 'caption': 'White title', 'text': 'HELLO', 'bbox': [-80, -160, -35, -10]}],
        'bbox_coord_space': 'abs_centralized', 'bbox_format': 'yxyx',
    }
    try:
        with sync_playwright() as playwright:
            options = {'headless': True, 'args': ['--no-sandbox']}
            if Path('/usr/bin/chromium').is_file():
                options['executable_path'] = '/usr/bin/chromium'
            browser = playwright.chromium.launch(**options)
            try:
                context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
                fixture = context.new_page()
                fixture.set_viewport_size({'width': 400, 'height': 240})
                fixture.set_content('<body style="margin:0;background:#253358;color:white;font:40px Arial"><span style="position:absolute;left:40px;top:40px">HELLO</span></body>')
                base_png = fixture.screenshot()
                fixture.set_content('<body style="margin:0;background:#253358;color:white;font:40px Arial"><span style="position:absolute;left:66px;top:40px">HELO</span></body>')
                sft_png = fixture.screenshot()
                fixture.set_viewport_size({'width': 384, 'height': 240})
                wrong_size_png = fixture.screenshot()
                fixture.close()
                page = context.new_page()
                page.on('pageerror', lambda error: failures.append(str(error)))
                page.on('request', lambda request: requests.append((request.method, request.url)))
                response = page.goto(base + 'evaluate.html', wait_until='networkidle')
                assert response.status == 200
                page.locator('#layout-json').fill(json.dumps(compiled))
                page.locator('#start').click()
                assert 'Compiled prompts omit dimensions' in page.locator('#setup-error').inner_text()
                checks.append('compiled prompt requires original dimensions')

                page.locator('#layout-width').fill('400')
                page.locator('#layout-height').fill('240')
                page.locator('#base-image').set_input_files({'name': 'base.png', 'mimeType': 'image/png', 'buffer': base_png})
                page.locator('#sft-image').set_input_files({'name': 'wrong-size.png', 'mimeType': 'image/png', 'buffer': wrong_size_png})
                page.locator('#start').click()
                page.wait_for_function("() => document.querySelector('#setup-error').textContent.includes('must be 400 × 240 pixels')")
                assert 'must be 400 × 240 pixels' in page.locator('#setup-error').inner_text()
                checks.append('reject mismatched image dimensions')
                page.locator('#sft-image').set_input_files({'name': 'sft.png', 'mimeType': 'image/png', 'buffer': sft_png})
                page.locator('#start').click()
                page.locator('#evaluation').wait_for(state='visible')
                assert 'x 40, y 40, w 150, h 45' in page.locator('#target-coordinates').inner_text()
                for side in ['A', 'B']:
                    head = page.locator(f'.side[data-side="{side}"] .side-head').inner_text()
                    assert 'Identity hidden' in head and 'Base' not in head and 'SFT' not in head
                assert page.locator('#setup').is_hidden() and page.locator('#results').is_hidden()
                checks.append('compiled non-square geometry and hidden identities')

                a = page.locator('.side[data-side="A"]')
                b = page.locator('.side[data-side="B"]')
                a.locator('canvas').scroll_into_view_if_needed()
                box = a.locator('canvas').bounding_box()
                start_x = box['x'] + box['width'] * 40 / 400
                start_y = box['y'] + box['height'] * 40 / 240
                end_x = box['x'] + box['width'] * 190 / 400
                end_y = box['y'] + box['height'] * 85 / 240
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.mouse.move(end_x, end_y, steps=5)
                page.mouse.up()
                a.locator('textarea').fill('HELLO')
                observed = [int(a.locator(f'[data-coordinate="{axis}"]').input_value()) for axis in 'xywh']
                assert abs(observed[0] - 40) <= 1 and abs(observed[1] - 40) <= 1
                assert abs(observed[2] - 150) <= 1 and abs(observed[3] - 45) <= 1
                b.locator('textarea').fill('HELO')
                for axis, value in [('x','66'),('y','40'),('w','125'),('h','45')]:
                    b.locator(f'[data-coordinate="{axis}"]').fill(value)
                b.locator('[data-status="missing"]').click()
                assert b.locator('textarea').input_value() == ''
                assert all(b.locator(f'[data-coordinate="{axis}"]').input_value() == '' for axis in 'xywh')
                assert page.locator('#reveal').is_enabled()
                checks.append('manual drag, transcription and missing state')

                page.locator('#reveal').click()
                assert page.locator('#results').is_visible()
                assert page.locator('#result-cards article').count() == 2
                with page.expect_download() as download_event:
                    page.locator('#download').click()
                output = json.loads(download_event.value.path().read_text())
                assert set(side['model'] for side in output['images'].values()) == {'Base', 'SFT'}
                assert all(len(side['sha256']) == 64 for side in output['images'].values())
                assert output['layout']['width'] == 400 and output['layout']['height'] == 240
                assert output['scores']['A']['exact'] == 1 and output['scores']['B']['missing'] == 1
                assert output['annotations']['B'][0]['transcription'] == '' and output['annotations']['B'][0]['box'] is None
                serialized = json.dumps(output)
                assert 'base.png' not in serialized and 'sft.png' not in serialized
                assert 'data:image' not in serialized and 'pixel_values' not in serialized
                checks.append('reveal, scores and image-free JSON export')
                page.close()

                for width in [390, 320]:
                    mobile = context.new_page()
                    mobile.set_viewport_size({'width': width, 'height': 844})
                    mobile.on('pageerror', lambda error: failures.append(str(error)))
                    mobile.goto(base + 'evaluate.html', wait_until='networkidle')
                    assert not mobile.evaluate('document.documentElement.scrollWidth > innerWidth')
                    assert mobile.locator('#setup').is_visible()
                    mobile.close()
                checks.append('390px and 320px layout')
                assert not failures, failures
                assert all(method == 'GET' and url.startswith(base) for method, url in requests), requests
                checks.append('no runtime uploads or third-party requests')
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
    print(json.dumps({'checks': checks, 'count': len(checks), 'base_url': base}))


if __name__ == '__main__':
    main()
