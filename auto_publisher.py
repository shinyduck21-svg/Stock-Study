import os
import re
import sys
import json
import time
import requests
from m3u8 import M3U8
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
GDRIVE_FOLDER_ID = "" 

# 구글 API 권한 범위
SCOPES = ['https://www.googleapis.com/auth/drive']

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
        response = requests.get(m3u8_url, headers=headers)
        playlist = M3U8(response.text)
        
        # 절대 경로 URL 리스트 추출
        base_url = m3u8_url.rsplit('/', 1)[0]
        segments = []
        for seg in playlist.segments:
            uri = seg.uri
            if not uri.startswith('http'):
                uri = f"{base_url}/{uri}"
            segments.append(uri)
            
        print(f"총 {len(segments)}개의 미디어 조각을 다운로드합니다...")
        
        with open(output_path, 'wb') as f_out:
            for idx, seg_url in enumerate(segments):
                # 다운로드 진행률 표시
                if idx % 10 == 0 or idx == len(segments) - 1:
                    print(f"진행 상황: {idx + 1}/{len(segments)} 완료")
                
                seg_resp = requests.get(seg_url, headers=headers)
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
        
        # 만약 로그인 페이지(네이버 등)로 리다이렉트 되었다면 로그인이 완료되어 유료 글 주소로 복귀할 때까지 대기
        if "nid.naver.com" in page.url or "login" in page.url:
            print("\n🔑 로그인이 필요합니다! 열린 크롬 브라우저에서 로그인을 완료해 주세요.")
            print("로그인이 완료되면 자동으로 포스트 수집이 시작됩니다...")
            while "nid.naver.com" in page.url or "login" in page.url:
                page.wait_for_timeout(1000)
            print("로그인 확인 완료! 데이터를 수집합니다.")
            
        # 페이지 로딩 및 미디어 로드 대기
        page.wait_for_timeout(7000) 
        
        # 글 제목 추출
        try:
            # us-insight.com 제목 요소 선택 (사이트 구조에 맞게 커스텀 필요)
            title_el = page.query_selector("h1") or page.query_selector(".post-title") or page.query_selector(".title")
            if title_el:
                media_data['title'] = title_el.inner_text().strip()
                print(f"📝 글 제목 추출 성공: {media_data['title']}")
        except Exception as e:
            print(f"제목 추출 실패: {e}")
            
        # 본문 마크다운 추출
        try:
            # us-insight.com 본문 요소 선택
            content_el = page.query_selector("article") or page.query_selector(".post-content") or page.query_selector(".content")
            if content_el:
                media_data['content'] = content_el.inner_text().strip()
                print("📝 본문 텍스트 추출 성공")
        except Exception as e:
            print(f"본문 추출 실패: {e}")

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
        resp = requests.get(audio_url, headers=headers)
        with open(local_audio_path, 'wb') as f:
            f.write(resp.content)
            
        # 구글 드라이브 업로드
        file_name = f"{media_data['title'] or 'audio'}_audio.mp3"
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
            resp = requests.get(video_url, headers=headers)
            with open(local_video_path, 'wb') as f:
                f.write(resp.content)
            success = True
            
        if success:
            file_name = f"{media_data['title'] or 'video'}_video.mp4"
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
        
    next_id = max([p['id'] for p in posts]) + 1 if posts else 1
    file_name = f"briefing_{str(next_id).zfill(2)}.md"
    
    # 2. 신규 포스트 객체 생성
    new_post = {
        "id": next_id,
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
    
    # 4. GitHub 자동 푸시
    print("\n[5단계] GitHub push 진행...")
    os.system("git add public/data/posts.json public/docs/briefing_*.md")
    os.system(f'git commit -m "Auto upload: {media_data["title"]}"')
    os.system("git push origin main")
    print("🎉 GitHub 배포 완료!")

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
