import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Menu,
  X,
  Github,
  MessageCircle,
  ChevronRight,
  Heart,
  Volume2,
  FileText,
  PlayCircle,
  ArrowLeft,
  ExternalLink,
  BookOpen,
  LayoutGrid,
  PlusCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import TurndownService from 'turndown';
import './App.css';

const App = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState('feed'); // 'feed' | 'detail'
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedPost, setSelectedPost] = useState(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [posts, setPosts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', category: '언제나 데이트', type: 'text', content: '', url: '', audioUrl: '' });
  const [isSaving, setIsSaving] = useState(false);

  // 카테고리 정의
  const categories = [
    { id: 'all', title: '전체 피드', icon: <LayoutGrid size={20} /> },
    { id: '언제나 데이트', title: '언제나 데이트', icon: <PlayCircle size={20} /> },
    { id: '굿모닝 담샘', title: '굿모닝 담샘', icon: <Volume2 size={20} /> },
    { id: '기업분석도감', title: '기업분석도감', icon: <BookOpen size={20} /> }
  ];

  // 구글 드라이브 ID 추출 유틸리티
  const getGoogleDriveId = (url) => {
    if (!url) return null;
    const matchId = url.match(/[?&]id=([^&#]+)/);
    if (matchId) return matchId[1];
    const matchFile = url.match(/\/file\/d\/([^/]+)/);
    if (matchFile) return matchFile[1];
    return null;
  };

  // JSON 데이터 로드
  useEffect(() => {
    fetch('./data/posts.json')
      .then(res => res.json())
      .then(data => setPosts(data))
      .catch(err => console.error('Error fetching posts:', err));
  }, []);

  const filteredPosts = activeCategory === 'all'
    ? posts
    : posts.filter(post => post.category === activeCategory);

  const handlePostClick = (post) => {
    setSelectedPost(post);
    setViewMode('detail');
    window.scrollTo(0, 0);
  };

  const handleCategoryClick = (catId) => {
    setActiveCategory(catId);
    setViewMode('feed');
    setSelectedPost(null);
    window.scrollTo(0, 0);
  };

  const handleBackToFeed = () => {
    setViewMode('feed');
    setSelectedPost(null);
  };

  const handleAddPost = async () => {
    if (!newPost.title.trim()) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/add-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost),
      });

      const result = await response.json();
      if (result.success) {
        // Update local state
        setPosts([result.post, ...posts]);
        // Open the new post immediately
        setSelectedPost(result.post);
        setViewMode('detail');
        setIsModalOpen(false);
        setNewPost({ title: '', category: '언제나 데이트', type: 'text', content: '', url: '', audioUrl: '' });
      }
    } catch (err) {
      console.error('Failed to add post:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePaste = (e) => {
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
      });
      // Optionally add plugins if needed, but basic turndown is usually enough
      const markdown = turndownService.turndown(html);

      // Insert into content at current cursor position or just append
      setNewPost({ ...newPost, content: newPost.content + markdown });
    }
  };

  // 마크다운 파일 로드 로직
  useEffect(() => {
    if (viewMode === 'detail' && selectedPost) {
      if (selectedPost.fileName) {
        fetch(`./docs/${selectedPost.fileName}`)
          .then(res => res.text())
          .then(text => setMarkdownContent(text))
          .catch(err => {
            console.error('Error fetching markdown:', err);
            setMarkdownContent('# 파일을 찾을 수 없습니다.');
          });
      }
    }
  }, [viewMode, selectedPost]);

  return (
    <div className="app-container">
      {/* Navigation */}
      <nav className="navbar glass-card">
        <div className="nav-content">
          <div className="logo-section" onClick={() => handleCategoryClick('all')}>
            <TrendingUp size={32} className="logo-icon" />
            <span className="gradient-text logo-text">위브즈 주식 투자고수방</span>
          </div>

          <div className="nav-links desktop-only">
            {/* GitHub 링크 제거됨 */}
          </div>

          <button className="mobile-menu-btn" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      <main className="main-content-layout">
        {/* Left Sidebar - Re-implemented as requested */}
        <aside className="sidebar-section glass-card desktop-only">
          <h2 className="section-title">카테고리</h2>
          <div className="list-items">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`list-item ${activeCategory === cat.id ? 'selected' : ''}`}
                onClick={() => handleCategoryClick(cat.id)}
              >
                <div className="item-info">
                  {cat.icon}
                  <span className="item-title">{cat.title}</span>
                </div>
                <ChevronRight size={18} />
              </div>
            ))}
          </div>

          <div className="write-btn-container">
            <button className="write-btn" onClick={() => setIsModalOpen(true)}>
              <PlusCircle size={20} /> 새 페이지 추가
            </button>
          </div>
        </aside>

        {/* Center Content Area */}
        <section className="content-area">
          {viewMode === 'feed' ? (
            <div className="feed-container">
              <header className="page-header">
                <h2 className="category-display-title">
                  {categories.find(c => c.id === activeCategory)?.title}
                </h2>
                <p className="hero-subtitle">최신 시장 트렌드와 전문가의 인사이트</p>
              </header>

              <div className="feed-list glass-card">
                {filteredPosts.length > 0 ? filteredPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`feed-card ${!post.thumbnail ? 'no-thumbnail' : ''}`}
                    onClick={() => handlePostClick(post)}
                  >
                    <div className="feed-card-content">
                      <div className="feed-meta-top">
                        {post.isNew && <span className="badge-new">NEW</span>}
                        <span className="feed-time">{post.time}</span>
                      </div>
                      <h2 className="feed-card-title">{post.title}</h2>
                      <div className="feed-category-info">
                        <span className="feed-type-label">
                          {post.type === 'video' && '영상'}
                          {post.type === 'text' && '글'}
                          {post.type === 'audio' && '오디오'}
                        </span>
                        <span className="separator">|</span>
                        <span className="feed-category-label">{post.category}</span>
                      </div>
                      <div className="feed-card-footer">
                        <div className="feed-likes">
                          <Heart size={18} className="heart-icon" />
                          <span>{post.likes}</span>
                        </div>
                        <span className={`badge-read ${post.isRead ? 'read' : 'unread'}`}>
                          {post.isRead ? '읽음' : '안읽음'}
                        </span>
                      </div>
                    </div>
                    {post.thumbnail && (
                      <div className="feed-card-thumbnail">
                        <img src={post.thumbnail} alt={post.title} />
                        {post.type === 'video' && <PlayCircle className="thumb-play-icon" size={40} />}
                        {post.type === 'audio' && <Volume2 className="thumb-play-icon" size={40} />}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="empty-state">해당 카테고리의 콘텐츠가 아직 없습니다.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="detail-container">
              <button className="back-btn" onClick={handleBackToFeed}>
                <ArrowLeft size={20} /> 리스트로 돌아가기
              </button>

              <article className="viewer-section glass-card">
                <header className="viewer-header">
                  <div className="viewer-meta">
                    <span className="viewer-category">{selectedPost.category}</span>
                    <span className="separator">|</span>
                    <span className="viewer-time">{selectedPost.time}</span>
                  </div>
                  <h2 className="viewer-title">{selectedPost.title}</h2>
                </header>

                <div className="viewer-content">
                  {/* 영상이 있는 경우 */}
                  {selectedPost.url && (
                    <div className="video-viewer">
                      <div className="video-container">
                        <iframe
                          key={selectedPost.url}
                          src={selectedPost.url}
                          title="Video player"
                          frameBorder="0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        ></iframe>
                      </div>
                    </div>
                  )}

                  {/* 오디오가 있는 경우 */}
                  {selectedPost.audioUrl && (
                    <div className="audio-player-bar glass-card">
                      <div className="audio-info">
                        <Volume2 size={20} className="primary-text" />
                        <span>{selectedPost.category} - 관련 음성 브리핑</span>
                      </div>
                      <div className="audio-embed-container">
                        <iframe
                          src={`https://drive.google.com/file/d/${getGoogleDriveId(selectedPost.audioUrl)}/preview`}
                          width="100%"
                          height="60"
                          frameBorder="0"
                          allow="autoplay"
                          title="Google Drive Audio Player"
                        ></iframe>
                      </div>
                    </div>
                  )}

                  {/* 텍스트(마크다운)가 있는 경우 */}
                  {selectedPost.fileName && (
                    <div className="markdown-viewer">
                      <div className="markdown-content">
                        <ReactMarkdown>{markdownContent}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            </div>
          )}
        </section>
      </main>

      <footer className="footer glass-card">
        <p>© 2026 위브즈 주식 투자고수방. All rights reserved.</p>
        <div className="footer-links">
          <a href="#"><MessageCircle size={20} /> 커뮤니티 참여</a>
        </div>
      </footer>

      {/* Write Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-card">
            <div className="modal-header">
              <h3 className="modal-title">새 페이지 추가</h3>
              <button className="close-btn" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">제목</label>
              <input
                type="text"
                className="form-input"
                placeholder="제목을 입력하세요"
                value={newPost.title}
                onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">카테고리</label>
              <select
                className="form-select"
                value={newPost.category}
                onChange={(e) => setNewPost({ ...newPost, category: e.target.value })}
              >
                {categories.filter(c => c.id !== 'all').map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.title}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">내용 (마크다운 지원)</label>
              <textarea
                className="form-textarea"
                placeholder="내용을 입력하세요 (예: # 제목, - 리스트)"
                value={newPost.content}
                onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                onPaste={handlePaste}
                rows={6}
              ></textarea>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">영상 링크 (YouTube/Drive)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://..."
                  value={newPost.url}
                  onChange={(e) => setNewPost({ ...newPost, url: e.target.value })}
                />
              </div>

              <div className="form-group flex-1">
                <label className="form-label">오디오 링크 (Drive)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://..."
                  value={newPost.audioUrl}
                  onChange={(e) => setNewPost({ ...newPost, audioUrl: e.target.value })}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsModalOpen(false)}>취소</button>
              <button
                className="btn-primary"
                onClick={handleAddPost}
                disabled={isSaving || !newPost.title.trim()}
              >
                {isSaving ? '생성 중...' : '페이지 생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
