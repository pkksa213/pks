"""Run against a built app served locally: APP_TEST_URL=http://127.0.0.1:8001."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

url = os.environ.get('APP_TEST_URL', 'http://127.0.0.1:8001')
remote_url = json.loads(Path('app.config.json').read_text())['scheduleDataUrl']
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, timezone_id='Europe/Warsaw', is_mobile=True, has_touch=True)
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda e:errors.append(str(e)))
    page.goto(url, wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert page.locator('#load-error').is_hidden()
    assert page.locator('#route-picker').input_value()=='ranizow_rzeszow'
    assert page.locator('#download-card').is_visible()
    with page.expect_download() as download_info:
        page.locator('#download-apk').click()
    download = download_info.value
    assert download.suggested_filename == 'ranizow-1.0.0.apk'
    assert Path(download.path()).read_bytes() == Path('downloads/ranizow-1.0.0.apk').read_bytes()
    page.locator('#ios-install-btn').click()
    assert page.locator('#info-panel').is_visible()
    page.keyboard.press('Escape')
    page.locator('#date-picker').fill('2026-11-12')
    page.locator('#date-picker').dispatch_event('change')
    page.locator('#journey-mode').select_option('transfer')
    assert page.locator('.trip--transfer').count()==1
    assert '08:42' in page.locator('.trip').inner_text()
    assert '09:44' in page.locator('.trip').inner_text()
    page.screenshot(path='artifacts/telefon-przesiadka.png',full_page=True)
    page.locator('#transfer-max').select_option('90')
    assert page.locator('.trip--transfer').count()==2
    page.locator('#inbound').click()
    assert page.locator('.trip--transfer').count()==0
    assert page.locator('.trip').count()>0
    assert page.locator('#transfer-options').is_hidden()
    page.locator('#route-picker').select_option('ranizow_glogow')
    assert page.locator('#transfer-options').is_hidden()
    assert page.locator('#inbound').is_hidden()
    assert page.locator('.trip').count()>0
    page.locator('#route-picker').select_option('ranizow_rzeszow')
    page.locator('#journey-mode').select_option('all')
    page.locator('#transfer-max').select_option('45')
    assert '18:05' not in page.locator('.badge--ekspresbus').evaluate_all('(els)=>els.map(e=>e.closest(".trip").textContent).join("\\n")')
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow at {width}'
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path='artifacts/telefon-rozklad.png',full_page=True)
    page.locator('#next-day').click()
    assert page.locator('#date-picker').input_value()=='2026-11-13'
    page.locator('#prev-day').click()
    page.locator('#info-btn').click()
    assert page.locator('#info-panel').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#info-panel').is_hidden()
    page.locator('#date-picker').fill('2027-01-12')
    page.locator('#date-picker').dispatch_event('change')
    assert page.locator('#validity-note').is_visible()
    assert page.locator('.badge--pks').count()==0
    # Wait for the installed worker, then verify an actual offline reload.
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    page.goto(url.rstrip('/') + '/?i=1', wait_until='networkidle')
    context.set_offline(True)
    page.reload(wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert 'zapisanego' in page.locator('#connection-status').inner_text()
    page.locator('#inbound').click()
    assert page.locator('.trip').count()>0
    assert not errors,errors
    print(json.dumps({'mobile_navigation':'passed','transfer_filters':'passed','no_glogow_ranizow_option':'passed','separate_glogow_route':'passed','withdrawn_trip':'passed','responsive_320_390_768':'passed','expired_data_warning':'passed','offline_reload':'passed','javascript_errors':errors}))
    browser.close()

# Native mode: select the configured HTTPS source, then use saved data on failure.
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(service_workers='block')
    context.add_init_script('window.Capacitor = { isNativePlatform: () => true };')
    data=json.loads(Path('data.json').read_text())
    requested=[]
    def remote(route):
        requested.append(route.request.url)
        route.fulfill(json=data, headers={'access-control-allow-origin':'*'})
    context.route(remote_url,remote)
    page=context.new_page()
    page.goto(url,wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert requested
    assert page.locator('#install-help').is_hidden()
    assert page.locator('#download-card').is_hidden()
    context.unroute(remote_url)
    context.route(remote_url,lambda route:route.fulfill(status=503,body='unavailable'))
    page.reload(wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert 'zapisanego' in page.locator('#connection-status').inner_text()
    browser.close()
    print('Native source selection and cached fallback: passed (mocked HTTPS, not a live hosting check)')

# iPhone Safari offers home-screen installation, never an Android APK.
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
    context=browser.new_context(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1',viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    page=context.new_page()
    page.goto(url,wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert page.locator('#download-apk').is_hidden()
    assert page.locator('#ios-install-btn').is_visible()
    page.locator('#ios-install-btn').click()
    assert page.locator('#info-panel').is_visible()
    assert 'Do ekranu początkowego' in page.locator('#install-help').inner_text()
    browser.close()
    print('iPhone installation instructions: passed (browser emulation, not a device test)')
