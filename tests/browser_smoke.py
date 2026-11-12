"""Smoke test for the simplified site and the same interface used by the APK."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

url=os.environ.get('APP_TEST_URL','http://127.0.0.1:8001')
remote_url=json.loads(Path('app.config.json').read_text())['scheduleDataUrl']
release=json.loads(Path('downloads/release.json').read_text())
launch={'executable_path':os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),'args':['--no-sandbox']}
with sync_playwright() as p:
    browser=p.chromium.launch(**launch)
    context=browser.new_context(viewport={'width':390,'height':844},timezone_id='Europe/Warsaw',is_mobile=True,has_touch=True)
    # Old saved filters must not hide either requested connection.
    context.add_init_script("localStorage.setItem('route-settings', JSON.stringify({pair:'ranizow_rzeszow',reverse:false,mode:'direct',minTransfer:15,maxTransfer:30}));")
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert page.locator('#load-error').is_hidden()
    assert page.locator('#journey-mode, #transfer-min, #transfer-max, #download-card').count()==0
    page.locator('#date-picker').fill('2026-11-12')
    page.locator('#date-picker').dispatch_event('change')
    assert page.locator('.trip--transfer').count()==2
    transfers=page.locator('.trip--transfer').all_inner_texts()
    assert '08:42' in transfers[0] and '09:06' in transfers[0] and '09:34' in transfers[0]
    assert '10:35' in transfers[1] and '11:00' in transfers[1] and '11:28' in transfers[1]
    assert all('Z przesiadką' in text for text in transfers)
    assert page.locator('.trip:not(.trip--transfer)').count()>0
    page.screenshot(path='artifacts/uproszczony-telefon.png',full_page=True)
    page.locator('#inbound').click()
    assert page.locator('.trip--transfer').count()==0
    assert page.locator('.trip').count()>0
    page.locator('#route-picker').select_option('ranizow_glogow')
    assert page.locator('#inbound').is_hidden()
    assert page.locator('.trip').count()>0
    page.locator('#route-picker').select_option('ranizow_rzeszow')
    for date in ['2026-11-11','2026-11-14','2026-11-15','2026-12-24','2026-12-25','2026-12-26']:
        page.locator('#date-picker').fill(date)
        page.locator('#date-picker').dispatch_event('change')
        assert page.locator('.trip--transfer').count()==0,date
        if date in ['2026-11-11','2026-12-24','2026-12-25','2026-12-26']:
            assert 'święto' in page.locator('#day-type').inner_text(),date
    page.locator('#date-picker').fill('2026-11-12')
    page.locator('#date-picker').dispatch_event('change')
    for width in [320,390,1280]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
    button=page.locator('#info-btn').bounding_box()
    assert button['width']<190 and button['height']<50
    page.screenshot(path='artifacts/uproszczony-komputer.png',full_page=True)
    page.locator('#info-btn').click()
    with page.expect_download() as event:page.locator('#download-apk').click()
    download=event.value
    assert download.suggested_filename==release['file']
    assert Path(download.path()).read_bytes()==Path('downloads',release['file']).read_bytes()
    page.keyboard.press('Escape')
    assert page.locator('#info-panel').is_hidden()
    page.locator('#next-day').click()
    assert page.locator('#date-picker').input_value()=='2026-11-13'
    page.locator('#prev-day').click()
    page.locator('#date-picker').fill('2027-01-12')
    page.locator('#date-picker').dispatch_event('change')
    assert page.locator('#validity-note').is_visible()
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    page.goto(url.rstrip('/')+'/?i=1',wait_until='networkidle')
    context.set_offline(True)
    page.reload(wait_until='networkidle')
    page.wait_for_selector('.trip')
    assert page.locator('#connection-status').is_visible()
    assert not errors,errors
    browser.close()
    print('PASS: single list, exactly two transfers, no filters, holidays/weekends, compact desktop button, APK download, offline reload; no JS errors')

with sync_playwright() as p:
    browser=p.chromium.launch(**launch)
    context=browser.new_context(service_workers='block')
    legacy=json.loads(Path('data.json').read_text());legacy.pop('connections',None)
    context.add_init_script('window.Capacitor={isNativePlatform:()=>true}; localStorage.setItem("schedule-v2",'+json.dumps(json.dumps(legacy))+');')
    held=[]
    context.route(remote_url,lambda route:held.append(route))
    page=context.new_page()
    page.goto(url,wait_until='domcontentloaded')
    page.wait_for_selector('.trip',timeout=3000)
    assert page.locator('#info-btn').is_hidden()
    assert len(held)==1
    # Reconnecting starts a fresh attempt. An older failed request must not
    # overwrite the successful state of the new attempt.
    with page.expect_request(remote_url):
        page.evaluate('window.dispatchEvent(new Event("online"))')
    deadline=time.monotonic()+3
    while len(held)<2 and time.monotonic()<deadline:page.wait_for_timeout(20)
    assert len(held)==2
    held[1].fulfill(json=json.loads(Path('data.json').read_text()),headers={'access-control-allow-origin':'*'})
    page.wait_for_function("!document.querySelector('#refresh-btn').disabled")
    held[0].fulfill(status=503,body='unavailable')
    page.wait_for_load_state('networkidle')
    assert page.locator('#connection-status').is_hidden()
    context.unroute(remote_url)
    context.route(remote_url,lambda route:route.fulfill(status=503,body='unavailable'))
    page.reload(wait_until='networkidle')
    page.locator('#date-picker').fill('2026-11-12');page.locator('#date-picker').dispatch_event('change')
    assert page.locator('.trip--transfer').count()==2
    assert page.locator('#connection-status').is_visible()
    assert 'Nie udało się zaktualizować' in page.locator('#connection-status').inner_text()
    assert 'Brak internetu' not in page.locator('#connection-status').inner_text()
    # A hosting browser-check HTML page is also a failed update, not no Internet.
    context.unroute(remote_url)
    context.route(remote_url,lambda route:route.fulfill(status=200,content_type='text/html',body='<html>Browser verification</html>'))
    page.locator('#refresh-btn').click()
    page.wait_for_function("!document.querySelector('#refresh-btn').disabled")
    assert 'Nie udało się zaktualizować' in page.locator('#connection-status').inner_text()
    assert page.locator('.trip--transfer').count()==2
    context.unroute(remote_url)
    context.route(remote_url,lambda route:route.fulfill(json=json.loads(Path('data.json').read_text())))
    page.evaluate('window.dispatchEvent(new Event("online"))')
    page.wait_for_function("!document.querySelector('#refresh-btn').disabled")
    assert page.locator('#connection-status').is_hidden()
    page.locator('#about-btn').click()
    assert page.locator('#install-help').is_hidden()
    browser.close()
    print('PASS: native cold start, separate server/network errors, HTML challenge fallback, reconnect retry and concurrent request ordering (mocked HTTPS)')

with sync_playwright() as p:
    browser=p.chromium.launch(**launch)
    context=browser.new_context(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1',viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    page=context.new_page();page.goto(url,wait_until='networkidle');page.wait_for_selector('.trip')
    page.locator('#info-btn').click()
    assert page.locator('#download-apk').is_hidden()
    assert 'Do ekranu początkowego' in page.locator('#install-help').inner_text()
    browser.close()
    print('PASS: iPhone home-screen installation instructions (browser emulation)')
