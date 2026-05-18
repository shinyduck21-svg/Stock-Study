import os
import re
import sys
import requests
import m3u8
from playwright.sync_api import sync_playwright

# 자동화 전용 크롬 프로필 경로
CHROME_USER_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chrome_profile")

def sanitize_filename(filename):
    # 윈도우 파일 시스템에서 금지하는 문자(\ / : * ? " < > |)를 언더바(_)로 치환
    return re.sub(r'[\/\\\:\*\?\"\<\>\|]', '_', filename).strip()

def download_hls(m3u8_url, output_path, headers):
    print(f"\n🎬 HLS(m3u8) 다운로드 시작: {m3u8_url}")
    try:
        # m3u8 라이브러리를 사용해 주소 분석
        playlist = m3u8.load(m3u8_url, headers=headers)
        
        # 만약 Master Playlist(다양한 화질 정보)라면 최적의 화질 스트림 선택
        if playlist.is_variant:
            print("Master Playlist 감지: 최적의 스트림을 선택합니다...")
            best_playlist = max(playlist.playlists, key=lambda p: p.stream_info.bandwidth if p.stream_info.bandwidth else 0)
            playlist_url = best_playlist.absolute_uri
            print(f"선택된 최적의 스트림 URL: {playlist_url}")
            playlist = m3u8.load(playlist_url, headers=headers)
            
        # 모든 세그먼트의 절대 경로 추출
        segments = [seg.absolute_uri for seg in playlist.segments]
        
        if not segments:
            print("오류: 다운로드할 세그먼트(조각) 파일이 없습니다.")
            return False
            
        print(f"총 {len(segments)}개의 미디어 조각을 다운로드합니다...")
        
        with open(output_path, 'wb') as f_out:
            for idx, seg_url in enumerate(segments):
                # 10개마다 진행 상황 출력
                if idx % 10 == 0 or idx == len(segments) - 1:
                    print(f"진행 상황: {idx + 1}/{len(segments)} 완료 ({(idx+1)/len(segments)*100:.1f}%)")
                
                seg_resp = requests.get(seg_url, headers=headers, timeout=15)
                seg_resp.raise_for_status()
                f_out.write(seg_resp.content)
                
        file_size = os.path.getsize(output_path) / (1024 * 1024)
        print(f"🎉 HLS 병합 완료! 파일 크기: {file_size:.2f} MB")
        return True
    except Exception as e:
        print(f"❌ HLS 다운로드 중 오류 발생: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print("사용법: python test_video_download.py <영상_게시글_URL>")
        sys.exit(1)
        
    post_url = sys.argv[1]
    print(f"📌 테스트 대상 URL: {post_url}")
    
    captured_videos = []
    
    with sync_playwright() as p:
        print("🔄 브라우저 실행 중 (chrome_profile 사용)...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=CHROME_USER_DATA,
            channel="chrome",
            headless=False,
            args=["--disable-blink-features=AutomationControlled"]
        )
        
        page = context.new_page()
        
        # 네트워크 응답 감시 (스니핑 기능)
        def handle_response(response):
            url = response.url
            if re.search(r'\.(m3u8|mp4)(\?.*)?$', url, re.IGNORECASE):
                # HLS의 개별 ts 조각은 제외
                if not re.search(r'\.ts(\?.*)?$', url, re.IGNORECASE):
                    if url not in captured_videos:
                        captured_videos.append(url)
                        print(f"💡 영상 주소 감지됨: {url}")
                        
        page.on("response", handle_response)
        
        print("🌐 페이지 이동 중...")
        page.goto(post_url)
        
        # 리다이렉트 대기 (최대 5초 동안 로그인 페이지로 이동하는지 확인)
        for _ in range(5):
            if "nid.naver.com" in page.url or "login" in page.url:
                break
            page.wait_for_timeout(1000)
            
        # 만약 로그인 페이지로 리다이렉트 되었다면 로그인 대기
        if "nid.naver.com" in page.url or "login" in page.url:
            print("\n🔑 로그인이 필요합니다! 열린 크롬 브라우저에서 로그인을 완료해 주세요.")
            while "nid.naver.com" in page.url or "login" in page.url:
                page.wait_for_timeout(1000)
            print("로그인 확인 완료! 다시 분석을 시작합니다.")
            
        print("⏳ 미디어 로딩 대기 중 (10초)... 영상을 재생시키면 더 확실하게 감지됩니다.")
        page.wait_for_timeout(10000)
        
        # 본문 마크다운 추출 (태그 분석 및 본문 첫 줄 추출용으로 최상단으로 올림)
        raw_markdown = ""
        content = ""
        content_el = (
            page.query_selector("article") or 
            page.query_selector(".post-content") or 
            page.query_selector(".content") or 
            page.query_selector(".post-body") or
            page.query_selector("main")
        )
        if content_el:
            html_content = content_el.inner_html().strip()
            try:
                import markdownify
                raw_markdown = markdownify.markdownify(html_content, heading_style="ATX").strip()
            except ImportError:
                raw_markdown = content_el.inner_text().strip()

        # 글 제목 추출
        title = "test_video"
        try:
            page_title = page.title()
            print(f"🔍 브라우저 탭 제목 감지: {page_title}")
            
            # 브랜드 키워드 정의 (로고, 탭, 멤버십 등 제외용)
            brand_keywords = ["서재형의 투자학교", "어스인사이트", "어스플러스", "US-Insight", "us-insight", "어스", "US"]
            
            extracted_title = ""
            
            # 1. 브라우저 탭 제목(page.title())을 최우선으로 분석
            if page_title:
                parts = [p.strip() for p in re.split(r' - | \| | : | – | — ', page_title) if p.strip()]
                if len(parts) > 1:
                    is_first_part_brand = any(k in parts[0] for k in brand_keywords)
                    if is_first_part_brand:
                        extracted_title = parts[1]
                    else:
                        extracted_title = parts[0]
                    print(f"📝 페이지 Title 기반 제목 추출 성공 (브랜드 분리): {extracted_title}")
                else:
                    is_brand = any(k in parts[0] for k in brand_keywords)
                    if not is_brand:
                        extracted_title = parts[0]
                        print(f"📝 페이지 Title 기반 제목 추출 성공: {extracted_title}")
            
            # 2. 탭 제목에서 추출에 실패한 경우 HTML 태그 기반 탐색 (Fallback)
            if not extracted_title:
                selectors = [
                    "article h1",
                    "main h1",
                    ".post-header h1",
                    ".post-title",
                    ".article-title",
                    ".entry-title",
                    ".subject",
                    "h1",
                    "h2"
                ]
                for sel in selectors:
                    el = page.query_selector(sel)
                    if el:
                        txt = el.inner_text().strip()
                        is_brand = any(k in txt for k in brand_keywords)
                        if txt and not is_brand:
                            extracted_title = txt
                            print(f"📝 태그 매칭 제목 추출 성공 ({sel}): {extracted_title}")
                            break
            
            # 3. 최후의 보루: 본문 내용의 첫 3줄 중에서 제목 모양의 유의미한 첫 행을 제목으로 채택!
            if not extracted_title and raw_markdown:
                lines = [l.strip() for l in raw_markdown.split('\n') if l.strip()]
                for line in lines[:3]:
                    is_brand = any(k in line for k in brand_keywords)
                    if not is_brand and len(line) > 3:
                        extracted_title = line
                        print(f"📝 본문 첫 줄 분석 추출 성공: {extracted_title}")
                        break

        # 본문 슬라이싱 처리 (제목 추출 완료 후 본문 원본 훼손 없이 정밀 슬라이싱)
        if raw_markdown:
            # "스크립트 보기Beta" 이후부터 "투자 유의사항 펼치기" 이전까지만 추출
            start_match = re.search(r'스크립트\s*보기', raw_markdown, re.IGNORECASE)
            start_idx = 0
            if start_match:
                start_idx = start_match.end()
            
            end_match = re.search(r'투자\s*유의사항\s*펼치기', raw_markdown)
            end_idx = len(raw_markdown)
            if end_match:
                end_idx = end_match.start()
                
            sliced_content = raw_markdown[start_idx:end_idx].strip()
            # 앞머리에 남아있을 수 있는 Beta 문자 정제
            sliced_content = re.sub(r'^(?:\s*Beta\s*|\s*\n\s*Beta\s*)', '', sliced_content, flags=re.IGNORECASE).strip()
            
            if sliced_content:
                content = sliced_content
            else:
                content = raw_markdown
                            
            if extracted_title:
                title = extracted_title
            else:
                print("❌ HTML 태그, 페이지 Title, 본문 분석 모두 감지 실패 혹은 브랜드명입니다.")
        except Exception as e:
            print(f"제목 추출 실패: {e}")
            
        # 다운로드에 필요한 헤더 따기
        cookies = context.cookies()
        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
        headers = {
            "User-Agent": page.evaluate("navigator.userAgent"),
            "Cookie": cookie_str,
            "Referer": post_url
        }
        
        context.close()
        
    if not captured_videos:
        print("\n❌ 감지된 영상 주소가 없습니다. 페이지에 영상이 플레이어 형태로 올라와 있는지 확인해 주세요.")
        return
        
    video_url = captured_videos[0]
    safe_title = sanitize_filename(title) if title else "test_video"
    local_video_path = f"{safe_title}.mp4"
    
    print(f"\n📥 [다운로드 테스트] 감지된 첫 번째 영상 다운로드 시도 ('{local_video_path}')...")
    
    success = False
    if ".m3u8" in video_url:
        success = download_hls(video_url, local_video_path, headers)
    else:
        try:
            print("MP4 직접 다운로드 시도 중...")
            resp = requests.get(video_url, headers=headers, stream=True)
            resp.raise_for_status()
            with open(local_video_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            file_size = os.path.getsize(local_video_path) / (1024 * 1024)
            print(f"🎉 MP4 다운로드 완료! 파일 크기: {file_size:.2f} MB")
            success = True
        except Exception as e:
            print(f"❌ MP4 다운로드 중 오류 발생: {e}")
            
    if success:
        print(f"\n👍 테스트 완료! 프로젝트 폴더(`c:\\AI\\Stock-Study\\`)에 생성된 '{local_video_path}' 파일을 직접 재생하여 잘 나오는지 확인해 보세요.")
    else:
        print("\n👎 다운로드 테스트 실패.")

if __name__ == "__main__":
    main()
