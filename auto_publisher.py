import os
import re
import sys
import json
import time
import requests
import m3u8
from playwright.sync_api import sync_playwright
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ==========================================
# ⚙️ 사용자 설정 영역 (내 환경에 맞게 변경)
# ==========================================
# 1. 자동화 전용 크롬 프로필 폴더 (프로젝트 폴더 내부에 생성하여 중복 실행 에러 방지)
CHROME_USER_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chrome_profile")
# 2. 사용할 크롬 프로필 이름 (기본값: "Default")
CHROME_PROFILE = "Default"
# 3. 구글 드라이브 업로드 대상 폴더 ID (비워두면 루트 폴더에 저장됩니다)
GDRIVE_FOLDER_ID = "1v9H6SxCxIelFLW_nfDkOYjZFX3t_3nNC" 

# 구글 API 권한 범위
SCOPES = ['https://www.googleapis.com/auth/drive']

def sanitize_filename(filename):
    # 윈도우 파일 시스템에서 금지하는 문자(\ / : * ? " < > |)를 언더바(_)로 치환
    return re.sub(r'[\/\\\:\*\?\"\<\>\|]', '_', filename).strip()

# ==========================================
# 📂 구글 드라이브 API 관련 함수
# ==========================================
def get_gdrive_service():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    return build('drive', 'v3', credentials=creds)

def upload_to_gdrive(service, file_path, file_name, mime_type):
    print(f"구글 드라이브에 {file_name} 업로드 중...")
    file_metadata = {'name': file_name}
    if GDRIVE_FOLDER_ID:
        file_metadata['parents'] = [GDRIVE_FOLDER_ID]
        
    media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id, webViewLink'
    ).execute()
    
    file_id = file.get('id')
    
    # 누구나 읽을 수 있게 공유 권한 부여
    service.permissions().create(
        fileId=file_id,
        body={'type': 'anyone', 'role': 'reader'}
    ).execute()
    
    print(f"업로드 완료! 파일 ID: {file_id}")
    return file_id, file.get('webViewLink')

# ==========================================
# ⬇️ HLS (.m3u8) 다운로드 및 병합 함수
# ==========================================
def download_hls(m3u8_url, output_path, headers):
    print(f"HLS 다운로드 시작: {m3u8_url}")
    try:
        playlist = m3u8.load(m3u8_url, headers=headers)
        
        # 만약 Master Playlist(다양한 화질 정보)라면 최적의 화질 스트림 선택
        if playlist.is_variant:
            print("Master Playlist 감지: 최적의 스트림을 선택합니다...")
            best_playlist = max(playlist.playlists, key=lambda p: p.stream_info.bandwidth if p.stream_info.bandwidth else 0)
            playlist_url = best_playlist.absolute_uri
            playlist = m3u8.load(playlist_url, headers=headers)
            
        # 모든 세그먼트의 절대 경로 추출
        segments = [seg.absolute_uri for seg in playlist.segments]
        
        if not segments:
            print("오류: 다운로드할 세그먼트 파일이 없습니다.")
            return False
            
        print(f"총 {len(segments)}개의 미디어 조각을 다운로드합니다...")
        
        with open(output_path, 'wb') as f_out:
            for idx, seg_url in enumerate(segments):
                # 다운로드 진행률 표시
                if idx % 10 == 0 or idx == len(segments) - 1:
                    print(f"진행 상황: {idx + 1}/{len(segments)} 완료")
                
                seg_resp = requests.get(seg_url, headers=headers, timeout=15)
                seg_resp.raise_for_status()
                f_out.write(seg_resp.content)
                
        print(f"HLS 병합 완료! 파일 저장됨: {output_path}")
        return True
    except Exception as e:
        print(f"HLS 다운로드 중 오류 발생: {e}")
        return False

# ==========================================
# 🌐 Playwright 기반 포스트 수집 함수
# ==========================================
def scrap_post(post_url):
    print(f"\n[1단계] 브라우저 실행 및 포스트 분석 시작...")
    
    media_data = {
        'title': '',
        'content': '',
        'audio_url': None,
        'video_url': None,
        'category': '언제나 데이트' # 기본값
    }
    
    captured_audios = []
    captured_videos = []
    
    with sync_playwright() as p:
        # 로그인 세션을 그대로 쓰기 위해 launch_persistent_context 사용
        context = p.chromium.launch_persistent_context(
            user_data_dir=CHROME_USER_DATA,
            channel="chrome", # 내 실제 구글 크롬 브라우저 실행
            headless=False,   # 눈으로 확인하기 위해 브라우저 창 띄움
            args=["--disable-blink-features=AutomationControlled"] # 봇 감지 우회
        )
        
        page = context.new_page()
        
        # 네트워크 응답 감시 (스니핑 기능)
        def handle_response(response):
            url = response.url
            # 오디오 요청 스니핑 (.mp3, .m4a 등)
            if re.search(r'\.(mp3|m4a|aac)(\?.*)?$', url, re.IGNORECASE):
                if url not in captured_audios:
                    captured_audios.append(url)
                    print(f"🔊 오디오 네트워크 요청 감지: {url}")
            # 비디오 HLS/MP4 요청 스니핑 (.m3u8, .mp4 등)
            elif re.search(r'\.(m3u8|mp4)(\?.*)?$', url, re.IGNORECASE):
                # HLS의 개별 ts 조각은 제외
                if not re.search(r'\.ts(\?.*)?$', url, re.IGNORECASE):
                    if url not in captured_videos:
                        captured_videos.append(url)
                        print(f"🎬 비디오 네트워크 요청 감지: {url}")
        
        page.on("response", handle_response)
        
        # 페이지 이동
        page.goto(post_url)
        
        # 리다이렉트 대기 (최대 5초 동안 로그인 페이지로 이동하는지 확인)
        for _ in range(5):
            if "nid.naver.com" in page.url or "login" in page.url:
                break
            page.wait_for_timeout(1000)
            
        # 만약 로그인 페이지(네이버 등)로 리다이렉트 되었다면 로그인이 완료되어 유료 글 주소로 복귀할 때까지 대기
        if "nid.naver.com" in page.url or "login" in page.url:
            print("\n🔑 로그인이 필요합니다! 열린 크롬 브라우저에서 로그인을 완료해 주세요.")
            print("로그인이 완료되면 자동으로 포스트 수집이 시작됩니다...")
            while "nid.naver.com" in page.url or "login" in page.url:
                page.wait_for_timeout(1000)
            print("로그인 확인 완료! 데이터를 수집합니다.")
            
        # 페이지 로딩 및 미디어 로드 대기
        page.wait_for_timeout(7000) 
        
        # 본문 마크다운 추출 (태그 분석 및 본문 첫 줄 추출용으로 최상단으로 올림)
        raw_markdown = ""
        try:
            # us-insight.com 본문 요소 선택
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
                    # markdownify를 활용하여 HTML 서식을 Markdown 양식으로 완벽 복원
                    raw_markdown = markdownify.markdownify(html_content, heading_style="ATX").strip()
                except ImportError:
                    raw_markdown = content_el.inner_text().strip()
        except Exception as e:
            print(f"본문 추출 실패: {e}")

        # 글 제목 추출
        media_data['title'] = ""
        try:
            page_title = page.title()
            
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
                            
            if extracted_title:
                media_data['title'] = extracted_title
            else:
                print("❌ HTML 태그, 페이지 Title, 본문 분석 모두 감지 실패 혹은 브랜드명입니다.")
        except Exception as e:
            print(f"제목 추출 실패: {e}")

        # 본문 슬라이싱 처리 (제목 추출 완료 후 본문 원본 훼손 없이 정밀 슬라이싱)
        media_data['content'] = ""
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
                media_data['content'] = sliced_content
                print("📝 본문 슬라이싱 완료!")
            else:
                media_data['content'] = raw_markdown
                print("📝 본문 슬라이싱 실패 또는 비어있어 원본 유지")

        # 브라우저 정보로부터 헤더 획득 (HLS 다운로드에 쿠키가 필요할 수 있음)
        cookies = context.cookies()
        cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
        headers = {
            "User-Agent": page.evaluate("navigator.userAgent"),
            "Cookie": cookie_str,
            "Referer": post_url
        }
        
        context.close()
        
    # 다운로드 및 구글 드라이브 업로드 처리
    gdrive_service = get_gdrive_service()
    
    # 1. 오디오 처리
    if captured_audios:
        audio_url = captured_audios[0]
        local_audio_path = "temp_audio.mp3"
        print(f"\n[2단계] 오디오 파일 다운로드 중...")
        resp = requests.get(audio_url, headers=headers, stream=True)
        resp.raise_for_status()
        with open(local_audio_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
            
        # 구글 드라이브 업로드
        safe_title = sanitize_filename(media_data['title']) if media_data['title'] else 'audio'
        file_name = f"{safe_title}.mp3"
        audio_id, audio_link = upload_to_gdrive(gdrive_service, local_audio_path, file_name, "audio/mpeg")
        media_data['audio_url'] = f"https://drive.google.com/file/d/{audio_id}/view"
        
        # 임시 파일 삭제
        if os.path.exists(local_audio_path):
            os.remove(local_audio_path)
            
    # 2. 비디오 처리
    if captured_videos:
        video_url = captured_videos[0]
        local_video_path = "temp_video.mp4"
        print(f"\n[3단계] 비디오 파일 다운로드 중...")
        
        success = False
        if ".m3u8" in video_url:
            # HLS 스트리밍 다운로드
            success = download_hls(video_url, local_video_path, headers)
        else:
            # 일반 mp4 다운로드
            resp = requests.get(video_url, headers=headers, stream=True)
            resp.raise_for_status()
            with open(local_video_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            success = True
            
        if success:
            safe_title = sanitize_filename(media_data['title']) if media_data['title'] else 'video'
            file_name = f"{safe_title}.mp4"
            video_id, video_link = upload_to_gdrive(gdrive_service, local_video_path, file_name, "video/mp4")
            # 내 사이트 비디오 뷰어 연동 주소로 사용
            media_data['video_url'] = f"https://drive.google.com/file/d/{video_id}/preview"
            
            # 임시 파일 삭제
            if os.path.exists(local_video_path):
                os.remove(local_video_path)
                
    return media_data

# ==========================================
# 🚀 사이트 데이터 반영 및 GitHub 푸시
# ==========================================
def update_site_and_push(media_data):
    if not media_data['title']:
        print("에러: 글 제목이 없어 반영하지 않습니다.")
        return
        
    print(f"\n[4단계] Stock-Study 프로젝트 반영 시작...")
    
    # 1. posts.json 파일 로드
    posts_path = "public/data/posts.json"
    if not os.path.exists(posts_path):
        print(f"에러: {posts_path} 파일을 찾을 수 없습니다. 경로를 확인해 주세요.")
        return
        
    with open(posts_path, 'r', encoding='utf-8') as f:
        posts = json.load(f)
        
    # 신규 포스트 생성 (중복 체크/덮어쓰기 없이 항상 새 번호를 부여하도록 개편)
    next_id = max([p['id'] for p in posts]) + 1 if posts else 1
    post_id = next_id
    file_name = f"briefing_{next_id}.md"
    print(f"➕ 신규 포스트를 추가합니다. (ID: {post_id})")
    
    new_post = {
        "id": post_id,
        "title": media_data['title'],
        "time": "방금 전",
        "type": "text",
        "category": media_data['category'],
        "likes": 0,
        "isRead": False,
        "isNew": True,
        "fileName": file_name
    }
    
    if media_data['video_url']:
        new_post['url'] = media_data['video_url']
        new_post['type'] = 'video'
    if media_data['audio_url']:
        new_post['audioUrl'] = media_data['audio_url']
        if new_post['type'] != 'video':
            new_post['type'] = 'audio'
            
    posts.insert(0, new_post)
    
    # json 저장
    with open(posts_path, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=4)
    print("posts.json 업데이트 완료.")
    
    # 3. .md 파일 생성
    md_path = f"public/docs/{file_name}"
    md_content = f"# {media_data['title']}\n\n{media_data['content']}"
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)
    print(f"{md_path} 생성 완료.")
    
    # 4. GitHub 자동 푸시 안내 (로컬 검증용으로 자동 푸시 일시 비활성화)
    print("\n==================================================")
    print("💾 [로컬 파일 업데이트 완료]")
    print("==================================================")
    print(f"✅ 데이터 반영 완료: {posts_path}")
    print(f"✅ 마크다운 생성 완료: {md_path}")
    print("\n🔍 로컬 브라우저에서 사이트가 정상적으로 동작하는지 확인해 주세요.")
    print("💡 수동으로 검증을 마치신 후, 아래 명령어로 GitHub에 직접 배포하실 수 있습니다:")
    print("--------------------------------------------------")
    print("git add public/data/posts.json public/docs/briefing_*.md")
    print(f'git commit -m "배포: {media_data["title"]}"')
    print("git push origin main")
    print("--------------------------------------------------\n")

# ==========================================
# 🏁 메인 실행부
# ==========================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python auto_publisher.py <포스트URL>")
        sys.exit(1)
        
    target_url = sys.argv[1]
    
    # 포스트 긁어오기 및 구글드라이브 업로드
    scraped_data = scrap_post(target_url)
    
    # 내 사이트에 적용 및 깃허브 배포
    update_site_and_push(scraped_data)
