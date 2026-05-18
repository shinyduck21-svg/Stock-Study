import os
import re
import sys
from playwright.sync_api import sync_playwright

# 자동화 전용 크롬 프로필 경로
CHROME_USER_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chrome_profile")

def sanitize_filename(filename):
    # 윈도우 파일 시스템에서 금지하는 문자(\ / : * ? " < > |)를 언더바(_)로 치환
    return re.sub(r'[\/\\\:\*\?\"\<\>\|]', '_', filename).strip()

def main():
    if len(sys.argv) < 2:
        print("사용법: python test_metadata.py <게시글_URL>")
        sys.exit(1)
        
    post_url = sys.argv[1]
    print(f"📌 [메타데이터 및 네트워크 스니핑 단독 테스트]")
    print(f"🔗 대상 URL: {post_url}\n")
    
    captured_videos = []
    captured_audios = []
    
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
            if re.search(r'\.(mp3|m4a|aac)(\?.*)?$', url, re.IGNORECASE):
                if url not in captured_audios:
                    captured_audios.append(url)
                    print(f"🔊 오디오 주소 감지: {url[:80]}...")
            elif re.search(r'\.(m3u8|mp4)(\?.*)?$', url, re.IGNORECASE):
                # HLS의 개별 ts 조각은 제외
                if not re.search(r'\.ts(\?.*)?$', url, re.IGNORECASE):
                    if url not in captured_videos:
                        captured_videos.append(url)
                        print(f"🎬 비디오 주소 감지: {url[:80]}...")
                        
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
            
        print("⏳ 미디어 로딩 및 데이터 수집 대기 중 (7초)... 영상을 재생해 주시면 감지에 매우 도움이 됩니다.")
        page.wait_for_timeout(7000)
        
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
        title = ""
        title_source = "감지 실패"
        page_title = page.title()
        
        # 브랜드 키워드 정의 (로고, 탭, 멤버십 등 제외용)
        brand_keywords = ["서재형의 투자학교", "어스인사이트", "어스플러스", "US-Insight", "us-insight", "어스", "US"]
        
        # 1. 브라우저 탭 제목(page.title())을 최우선으로 분석
        if page_title:
            parts = [p.strip() for p in re.split(r' - | \| | : | – | — ', page_title) if p.strip()]
            if len(parts) > 1:
                # 첫 번째 파트가 브랜드 키워드인 경우 두 번째 파트를 택함
                is_first_part_brand = any(k in parts[0] for k in brand_keywords)
                if is_first_part_brand:
                    title = parts[1]
                else:
                    title = parts[0]
                title_source = "브라우저 탭 제목 (브랜드 분리)"
            else:
                is_brand = any(k in parts[0] for k in brand_keywords)
                if not is_brand:
                    title = parts[0]
                    title_source = "브라우저 탭 제목"
                    
        # 2. 탭 제목에서 글 제목 추출에 실패한 경우 HTML 태그 기반 탐색 (Fallback)
        if not title:
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
                    # 브랜드 명칭이 포함되지 않은 진짜 제목만 선택
                    is_brand = any(k in txt for k in brand_keywords)
                    if txt and not is_brand:
                        title = txt
                        title_source = f"HTML 태그 매칭 ({sel})"
                        break
                        
        # 3. 최후의 보루: 본문 내용의 첫 3줄 중에서 제목 모양의 유의미한 첫 행을 제목으로 채택!
        if not title and raw_markdown:
            lines = [l.strip() for l in raw_markdown.split('\n') if l.strip()]
            for line in lines[:3]:
                is_brand = any(k in line for k in brand_keywords)
                if not is_brand and len(line) > 3:
                    title = line
                    title_source = "본문 첫 줄 분석 추출"
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
                    
        # 최종 확인 (만약 여전히 브랜드 키워드가 남아있거나 비어있다면 감지 실패 처리)
        if not title or any(k in title for k in brand_keywords):
            title = "Unknown_Title"
            title_source = "브랜드명 단독 감지 혹은 감지 실패로 인해 대체"
            
        context.close()
        
    print("\n" + "="*60)
    print("📊 [분석 결과 요약 (다운로드 없이 정보만 확인)]")
    print("="*60)
    print(f"📝 추출된 원본 제목: {title}")
    print(f"🔍 제목 추출 소스  : {title_source}")
    print(f"💾 변환할 안전한 파일명: {sanitize_filename(title)}")
    print("-"*60)
    print(f"🎥 감지된 비디오 스트림 개수: {len(captured_videos)}")
    for idx, v in enumerate(captured_videos):
        print(f"   [{idx+1}] {v}")
    print(f"🎵 감지된 오디오 파일 개수: {len(captured_audios)}")
    for idx, a in enumerate(captured_audios):
        print(f"   [{idx+1}] {a}")
    print("-"*60)
    print(f"📄 본문 텍스트 길이: {len(content)} 자")
    if content:
        print(f"   (본문 앞부분): {content[:120].replace(chr(10), ' ')}...")
    print("="*60)
    print("💡 분석 결과가 정확하다면 배포 스크립트(auto_publisher.py)를 실행해 주세요!")

if __name__ == "__main__":
    main()
