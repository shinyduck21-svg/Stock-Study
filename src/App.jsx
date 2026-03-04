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
  LayoutGrid
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const App = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState('feed'); // 'feed' | 'detail'
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedPost, setSelectedPost] = useState(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [posts, setPosts] = useState([]);

  // 카테고리 정의
  const categories = [
    { id: 'all', title: '전체 피드', icon: <LayoutGrid size={20} /> },
    { id: '언제나 데이트', title: '언제나 데이트', icon: <PlayCircle size={20} /> },
    { id: '굿모닝 담샘', title: '굿모닝 담샘', icon: <Volume2 size={20} /> },
    { id: '기업분석도감', title: '기업분석도감', icon: <BookOpen size={20} /> }
  ];

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

  // 마크다운 파일 로드 로직
  useEffect(() => {
    if (viewMode === 'detail' && selectedPost && (selectedPost.type === 'text' || selectedPost.type === 'audio')) {
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
            <a href="https://github.com" target="_blank" rel="noreferrer" className="github-link">
              <Github size={20} />
              GitHub
            </a>
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
                  <div key={post.id} className="feed-card" onClick={() => handlePostClick(post)}>
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
                    <div className="feed-card-thumbnail">
                      <img src={post.thumbnail} alt={post.title} />
                      {post.type === 'video' && <PlayCircle className="thumb-play-icon" size={40} />}
                      {post.type === 'audio' && <Volume2 className="thumb-play-icon" size={40} />}
                    </div>
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
                          src={`https://drive.google.com/file/d/${selectedPost.audioUrl.split('id=')[1]}/preview`}
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

                <footer className="edit-footer">
                  <a href="https://github.com" target="_blank" rel="noreferrer" className="edit-btn">
                    <ExternalLink size={16} /> 깃허브에서 이 문서 수정하기
                  </a>
                </footer>
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
    </div>
  );
};

export default App;
