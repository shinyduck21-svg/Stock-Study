import React, { useState, useEffect, useRef } from 'react';
import {
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
  PlusCircle,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Sun,
  Moon,
  Maximize,
  Minimize
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import TurndownService from 'turndown';
import './App.css';

// 구글 드라이브 ID 추출 유틸리티
const getGoogleDriveId = (url) => {
  if (!url) return null;
  const matchId = url.match(/[?&]id=([^&#]+)/);
  if (matchId) return matchId[1];
  const matchFile = url.match(/\/file\/d\/([^/]+)/);
  if (matchFile) return matchFile[1];
  return null;
};

// 모바일 최적화 프리미엄 오디오 플레이어 (Media Session API 탑재)
const PremiumAudioPlayer = ({ url, title, category }) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [hasError, setHasError] = useState(false);
  const [forceIframe, setForceIframe] = useState(false);

  const getStreamUrl = (u) => {
    const driveId = getGoogleDriveId(u);
    if (!driveId) return u;
    // 구글 드라이브 HTML5 직접 스트리밍 및 이어듣기용 다이렉트 주소
    return `https://drive.google.com/uc?export=download&id=${driveId}`;
  };

  const getPreviewUrl = (u) => {
    const driveId = getGoogleDriveId(u);
    if (!driveId) return u;
    return `https://drive.google.com/file/d/${driveId}/preview`;
  };

  const streamUrl = getStreamUrl(url);
  const previewUrl = getPreviewUrl(url);

  // 이전에 듣던 재생 시간 복원 (이어듣기 지원)
  useEffect(() => {
    const savedTime = localStorage.getItem(`audio-resume-${url}`);
    if (savedTime && audioRef.current) {
      audioRef.current.currentTime = parseFloat(savedTime);
      setCurrentTime(parseFloat(savedTime));
    } else {
      setCurrentTime(0);
    }
    setIsPlaying(false);
    setHasError(false);
    setForceIframe(false);
  }, [url]);

  // 실시간 재생 시간 및 이력 로컬 저장소 기록
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const current = audioRef.current.currentTime;
      setCurrentTime(current);
      localStorage.setItem(`audio-resume-${url}`, current.toString());
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play()
          .then(() => setIsPlaying(true))
          .catch(e => {
            console.log("Audio play failed, using fallback: ", e);
            setHasError(true);
          });
      }
    }
  };

  const skip = (amount) => {
    if (audioRef.current) {
      const nextTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + amount));
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const handleProgressChange = (e) => {
    if (audioRef.current) {
      const newTime = parseFloat(e.target.value);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleRateChange = () => {
    const nextRates = [1.0, 1.25, 1.5, 1.8, 2.0];
    const currentIndex = nextRates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % nextRates.length;
    const nextRate = nextRates[nextIndex];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  // HTML5 Media Session API 연동 (모바일 잠금화면, 알림창 네이티브 제어 완벽 대응)
  useEffect(() => {
    if ('mediaSession' in navigator && audioRef.current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || '음성 브리핑',
        artist: '서재형의 투자학교',
        album: category || '데일리 브리핑',
        artwork: [
          { src: 'https://resource.us-insight.com/dev/image/png/1728833285070_24a08f79/1728833285070?w=512', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => {
        audioRef.current.play().then(() => setIsPlaying(true));
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current.pause();
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    }
  }, [url, title, category, duration]);

  const formatTime = (time) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (forceIframe) {
    return (
      <div className="premium-audio-player glass-card">
        <iframe
          src={previewUrl}
          title="Google Drive Audio Player"
          frameBorder="0"
          className="audio-drive-preview"
          allow="autoplay"
        ></iframe>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="premium-audio-player audio-error-state glass-card">
        <div className="player-error-content">
          <h3 className="error-title">오디오를 바로 재생할 수 없습니다</h3>
          <p className="error-desc">
            Google Drive가 직접 스트리밍을 제한하고 있습니다. 같은 화면에서 Drive 기본 플레이어로 재생할 수 있습니다.
          </p>
          <div className="error-buttons">
            <button
              onClick={() => setForceIframe(true)}
              className="btn-primary"
            >
              현재 화면에서 재생
            </button>
            <button
              onClick={() => window.open(previewUrl, '_blank')}
              className="btn-secondary"
            >
              새 창에서 열기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="premium-audio-player glass-card">
      <audio
        ref={audioRef}
        src={streamUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          console.error("Audio streaming failed, using fallback:", e);
          setHasError(true);
        }}
        preload="metadata"
      />
      
      <div className="player-info">
        <div className={`pulse-dot ${isPlaying ? 'active' : ''}`}></div>
        <div className="player-meta-txt">
          <span className="player-title">{title}</span>
          <span className="player-badge">{category}</span>
        </div>
      </div>

      <div className="player-controls">
        <button onClick={() => skip(-10)} className="btn-skip" title="10초 뒤로">
          <RotateCcw size={20} />
          <span className="skip-label">10</span>
        </button>

        <button onClick={togglePlay} className="btn-play-pause">
          {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
        </button>

        <button onClick={() => skip(10)} className="btn-skip" title="10초 앞으로">
          <RotateCw size={20} />
          <span className="skip-label">10</span>
        </button>

        <button onClick={handleRateChange} className="btn-speed">
          {playbackRate}x
        </button>
      </div>

      <div className="player-progress-bar">
        <span className="time-display">{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleProgressChange}
          className="progress-slider"
        />
        <span className="time-display">{formatTime(duration)}</span>
      </div>
    </div>
  );
};

// 모바일 최적화 프리미엄 비디오 플레이어 (커스텀 오버레이 컨트롤 바 탑재)
const PremiumVideoPlayer = ({ url, title, category }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [forceIframe, setForceIframe] = useState(false);
  const controlsTimeoutRef = useRef(null);

  const getStreamUrl = (u) => {
    const driveId = getGoogleDriveId(u);
    if (!driveId) return u;
    return `https://docs.google.com/uc?export=download&id=${driveId}`;
  };

  const streamUrl = getStreamUrl(url);

  // 이전에 보던 위치 복원 (이어보기 지원) 및 상태 초기화
  useEffect(() => {
    const savedTime = localStorage.getItem(`video-resume-${url}`);
    if (savedTime && videoRef.current) {
      videoRef.current.currentTime = parseFloat(savedTime);
      setCurrentTime(parseFloat(savedTime));
    } else {
      setCurrentTime(0);
    }
    setIsPlaying(false);
    setHasError(false);
    setForceIframe(false);
  }, [url]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const current = videoRef.current.currentTime;
      setCurrentTime(current);
      localStorage.setItem(`video-resume-${url}`, current.toString());
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const togglePlay = (e) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play()
          .then(() => setIsPlaying(true))
          .catch(err => console.log("Play failed: ", err));
      }
    }
  };

  const skip = (amount, e) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      const nextTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + amount));
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      resetControlsTimeout();
    }
  };

  const handleProgressChange = (e) => {
    if (videoRef.current) {
      const newTime = parseFloat(e.target.value);
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      resetControlsTimeout();
    }
  };

  const handleRateChange = (e) => {
    if (e) e.stopPropagation();
    const nextRates = [1.0, 1.25, 1.5, 1.8, 2.0];
    const currentIndex = nextRates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % nextRates.length;
    const nextRate = nextRates[nextIndex];
    setPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
    resetControlsTimeout();
  };

  const toggleFullscreen = (e) => {
    if (e) e.stopPropagation();
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(err => console.log("Fullscreen failed: ", err));
    } else {
      document.exitFullscreen()
        .then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  const formatTime = (time) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (forceIframe) {
    return (
      <div className="premium-video-player-container glass-card">
        <iframe
          src={url}
          title="Google Drive Video Player (Iframe Fallback)"
          frameBorder="0"
          style={{ width: '100%', height: '100%', borderRadius: '20px' }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        ></iframe>
      </div>
    );
  }

  if (hasError && !forceIframe) {
    return (
      <div className="premium-video-player-container error-state glass-card">
        <div className="player-error-content">
          <div className="error-icon">⚠️</div>
          <h3 className="error-title">대용량 영상 스트리밍 안내</h3>
          <p className="error-desc">
            이 영상은 100MB를 초과하는 **대용량 수업 녹화본**입니다. 구글 드라이브 보안 정책(대용량 파일 바이러스 검사 경고)으로 인해 네이티브 다이렉트 스트리밍이 제한되었습니다.
          </p>
          <div className="error-buttons">
            <button 
              onClick={() => window.open(url, '_blank')} 
              className="btn-primary"
            >
              🎬 구글 드라이브 앱으로 시청
            </button>
            <button 
              onClick={() => setForceIframe(true)} 
              className="btn-secondary"
            >
              🔄 현재 화면에서 재생 (기본 플레이어)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="premium-video-player-container glass-card"
      onMouseMove={resetControlsTimeout}
      onTouchStart={resetControlsTimeout}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={togglePlay}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          console.error("Video streaming failed, using fallback:", e);
          setHasError(true);
        }}
        playsInline
        preload="metadata"
      />

      {/* Giant touch play overlay */}
      <div className={`video-overlay-play-btn ${!isPlaying || showControls ? 'visible' : ''}`} onClick={togglePlay}>
        {isPlaying ? <Pause size={36} fill="white" /> : <Play size={36} fill="white" style={{ marginLeft: '4px' }} />}
      </div>

      {/* Touch controls bar */}
      <div className={`video-controls-bar glass-card ${showControls ? 'visible' : 'hidden'}`} onClick={(e) => e.stopPropagation()}>
        <div className="video-progress-row">
          <span className="video-time-display">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleProgressChange}
            className="video-progress-slider"
          />
          <span className="video-time-display">{formatTime(duration)}</span>
        </div>

        <div className="video-buttons-row">
          <div className="video-left-buttons">
            <button onClick={(e) => skip(-10, e)} className="video-btn" title="10초 뒤로">
              <RotateCcw size={16} />
            </button>
            <button onClick={togglePlay} className="video-btn video-play-toggle">
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <button onClick={(e) => skip(10, e)} className="video-btn" title="10초 앞으로">
              <RotateCw size={16} />
            </button>
          </div>

          <div className="video-right-buttons">
            <button onClick={handleRateChange} className="video-speed-btn">
              {playbackRate}x
            </button>
            <button onClick={toggleFullscreen} className="video-btn">
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState('feed'); // 'feed' | 'detail'
  const defaultTerm = '26년 봄학기';
  const [activeTerm, setActiveTerm] = useState(defaultTerm);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedPost, setSelectedPost] = useState(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [posts, setPosts] = useState([]);
  const [readPostIds, setReadPostIds] = useState([]); // 읽은 게시글 ID 목록
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', term: defaultTerm, category: '언제나 데이트', type: 'text', content: '', url: '', audioUrl: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [playMode, setPlayMode] = useState('normal'); // 'normal' | 'audio-only' (비디오인 경우 오디오만 백그라운드 재생 지원)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);


  // 카테고리 정의
  const terms = [
    { id: '개나리반', title: '개나리반', icon: <BookOpen size={20} />, categories: [] },
    { id: '26년 봄학기', title: '26년 봄학기', icon: <LayoutGrid size={20} />, categories: ['언제나 데이트', '굿모닝 담샘', '기업분석도감'] },
    { id: '26년 여름학기', title: '26년 여름학기', icon: <LayoutGrid size={20} />, categories: ['언제나 데이트', '굿모닝 담샘', '기업분석도감'] }
  ];

  const categoryMeta = {
    all: { id: 'all', title: '전체', icon: <LayoutGrid size={18} /> },
    '언제나 데이트': { id: '언제나 데이트', title: '언제나 데이트', icon: <PlayCircle size={18} /> },
    '굿모닝 담샘': { id: '굿모닝 담샘', title: '굿모닝 담샘', icon: <Volume2 size={18} /> },
    '기업분석도감': { id: '기업분석도감', title: '기업분석도감', icon: <BookOpen size={18} /> }
  };

  const getPostTerm = (post) => post.term || defaultTerm;
  const getTermCategories = (termId) => terms.find(term => term.id === termId)?.categories || [];

  // 구글 드라이브 ID 추출 유틸리티
  const getGoogleDriveId = (url) => {
    if (!url) return null;
    const matchId = url.match(/[?&]id=([^&#]+)/);
    if (matchId) return matchId[1];
    const matchFile = url.match(/\/file\/d\/([^/]+)/);
    if (matchFile) return matchFile[1];
    return null;
  };

  // JSON 데이터 및 로컬 저장소 로드
  useEffect(() => {
    fetch('./data/posts.json')
      .then(res => res.json())
      .then(data => setPosts(data))
      .catch(err => console.error('Error fetching posts:', err));

    // 로컬 저장소에서 읽은 글 목록 불러오기
    const savedReadPosts = localStorage.getItem('readPostIds');
    if (savedReadPosts) {
      setReadPostIds(JSON.parse(savedReadPosts));
    }
  }, []);

  const filteredPosts = posts.filter(post => {
    if (getPostTerm(post) !== activeTerm) return false;
    if (activeCategory !== 'all' && post.category !== activeCategory) return false;
    return true;
  });

  const activeTermInfo = terms.find(term => term.id === activeTerm);
  const activeCategoryTitle = activeCategory === 'all'
    ? `${activeTermInfo?.title || activeTerm} 전체`
    : `${activeTermInfo?.title || activeTerm} · ${categoryMeta[activeCategory]?.title || activeCategory}`;


  // 브라우저 히스토리 (뒤로가기) 지원
  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state) {
        setViewMode(event.state.viewMode || 'feed');
        setSelectedPost(event.state.selectedPost || null);
        setActiveTerm(event.state.activeTerm || defaultTerm);
        setActiveCategory(event.state.activeCategory || 'all');
        setPlayMode('normal');
      } else {
        setViewMode('feed');
        setSelectedPost(null);
        setActiveTerm(defaultTerm);
        setActiveCategory('all');
        setPlayMode('normal');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handlePostClick = (post) => {
    setSelectedPost(post);
    setViewMode('detail');
    setPlayMode('normal');
    window.scrollTo(0, 0);
    
    // 읽음 처리 추가
    if (!readPostIds.includes(post.id)) {
      const newReadPosts = [...readPostIds, post.id];
      setReadPostIds(newReadPosts);
      localStorage.setItem('readPostIds', JSON.stringify(newReadPosts));
    }

    // 히스토리 추가
    window.history.pushState(
      { viewMode: 'detail', selectedPost: post, activeTerm: activeTerm, activeCategory: activeCategory },
      '',
      `#post-${post.id}`
    );
  };

  const handleTermClick = (termId) => {
    setActiveTerm(termId);
    setActiveCategory('all');
    setViewMode('feed');
    setSelectedPost(null);
    setPlayMode('normal');
    window.scrollTo(0, 0);

    window.history.pushState(
      { viewMode: 'feed', selectedPost: null, activeTerm: termId, activeCategory: 'all' },
      '',
      `#term-${encodeURIComponent(termId)}`
    );
  };

  const handleCategoryClick = (catId, termId = activeTerm) => {
    setActiveTerm(termId);
    setActiveCategory(catId);
    setViewMode('feed');
    setSelectedPost(null);
    setPlayMode('normal');
    window.scrollTo(0, 0);

    // 히스토리 추가
    window.history.pushState(
      { viewMode: 'feed', selectedPost: null, activeTerm: termId, activeCategory: catId },
      '',
      `#term-${encodeURIComponent(termId)}${catId === 'all' ? '' : `-${encodeURIComponent(catId)}`}`
    );
  };

  const handleBackToFeed = () => {
    setViewMode('feed');
    setSelectedPost(null);
    setPlayMode('normal');
    window.history.pushState(
      { viewMode: 'feed', selectedPost: null, activeTerm: activeTerm, activeCategory: activeCategory },
      '',
      `#term-${encodeURIComponent(activeTerm)}${activeCategory === 'all' ? '' : `-${encodeURIComponent(activeCategory)}`}`
    );
  };

  const handleNewPostTermChange = (termId) => {
    const nextCategories = getTermCategories(termId);
    setNewPost({
      ...newPost,
      term: termId,
      category: nextCategories.includes(newPost.category) ? newPost.category : (nextCategories[0] || '언제나 데이트')
    });
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
        handlePostClick(result.post);
        setIsModalOpen(false);
        setNewPost({ title: '', term: defaultTerm, category: '언제나 데이트', type: 'text', content: '', url: '', audioUrl: '' });
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
            <img src="./assets/stock-gosu-app-icon.png" alt="" className="app-logo-image" />
            <span className="gradient-text logo-text">주식 투자 고수방</span>
          </div>

          <div className="nav-actions">
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="theme-toggle-btn"
              title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
              aria-label="화면 테마 변경"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <button className="mobile-menu-btn" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </nav>

      <main className="main-content-layout">
        {/* Left Sidebar - Re-implemented as requested */}
        <aside className="sidebar-section glass-card desktop-only">
          <div className="sidebar-group">
            <h2 className="section-title">카테고리</h2>
            <div className="list-items">
              {terms.map((term) => (
                <div key={term.id} className="term-block">
                  <div
                    className={`list-item term-item ${activeTerm === term.id && activeCategory === 'all' ? 'selected' : ''}`}
                    onClick={() => handleTermClick(term.id)}
                  >
                    <div className="item-info">
                      {term.icon}
                      <span className="item-title">{term.title}</span>
                    </div>
                    <ChevronRight size={18} />
                  </div>

                  {activeTerm === term.id && term.categories.length > 0 && (
                    <div className="sub-list-items">
                      <div
                        className={`sub-list-item ${activeCategory === 'all' ? 'selected' : ''}`}
                        onClick={() => handleCategoryClick('all', term.id)}
                      >
                        {categoryMeta.all.icon}
                        <span>{term.title} 전체</span>
                      </div>
                      {term.categories.map((categoryId) => (
                        <div
                          key={categoryId}
                          className={`sub-list-item ${activeCategory === categoryId ? 'selected' : ''}`}
                          onClick={() => handleCategoryClick(categoryId, term.id)}
                        >
                          {categoryMeta[categoryId]?.icon}
                          <span>{categoryMeta[categoryId]?.title || categoryId}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-group post-list-group">
            <h2 className="section-title">학습 목록</h2>
            <div className="sidebar-post-list">
              {filteredPosts.length > 0 ? (
                filteredPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`sidebar-post-item ${selectedPost?.id === post.id ? 'active' : ''} ${readPostIds.includes(post.id) ? 'is-read' : ''}`}
                    onClick={() => handlePostClick(post)}
                  >
                    <div className="post-item-type">
                      {post.type === 'video' && <PlayCircle size={14} />}
                      {post.type === 'audio' && <Volume2 size={14} />}
                      {post.type === 'text' && <FileText size={14} />}
                    </div>
                    <div className="post-item-content">
                      <span className="post-item-title">{post.title}</span>
                      <span className="post-item-time">{post.time}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-sidebar">글이 없습니다.</div>
              )}
            </div>
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
                  {activeCategoryTitle}
                </h2>
                <p className="hero-subtitle">최신 시장 트렌드와 전문가의 인사이트</p>
              </header>

              <div className="feed-list glass-card">
                {filteredPosts.length > 0 ? filteredPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`feed-card ${!post.thumbnail ? 'no-thumbnail' : ''} ${readPostIds.includes(post.id) ? 'is-read' : ''}`}
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
                        <span className={`badge-read ${readPostIds.includes(post.id) ? 'read' : 'unread'}`}>
                          {readPostIds.includes(post.id) ? '읽음' : '안읽음'}
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
                  {/* 영상이 있는 경우 (비디오 모드 vs 오디오 전용 모드 토글 지원) */}
                  {selectedPost.url && (
                    <div className="media-section-wrapper">
                      <div className="viewer-mode-selector glass-card">
                        <button
                          className={`mode-btn ${playMode === 'normal' ? 'active' : ''}`}
                          onClick={() => setPlayMode('normal')}
                        >
                          🎬 비디오 플레이어
                        </button>
                        <button
                          className={`mode-btn ${playMode === 'audio-only' ? 'active' : ''}`}
                          onClick={() => setPlayMode('audio-only')}
                          title="화면을 끄거나 백그라운드에서도 라디오처럼 들을 수 있습니다."
                        >
                          🎧 모바일 오디오 모드 (백그라운드/배속 지원)
                        </button>
                      </div>

                      {playMode === 'normal' ? (
                        <div className="video-viewer animate-fade-in">
                          <PremiumVideoPlayer
                            url={selectedPost.url}
                            title={selectedPost.title}
                            category={selectedPost.category}
                          />
                          <div className="alternative-player-link">
                            <a
                              href={selectedPost.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="네이티브 플레이어가 잘 안나올 경우 클릭하세요"
                            >
                              🎬 구글 드라이브 기본 플레이어(새 창)로 열기
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="audio-viewer-wrapper animate-fade-in">
                          <PremiumAudioPlayer
                            url={selectedPost.url}
                            title={selectedPost.title}
                            category={selectedPost.category}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 오디오가 있는 경우 (프리미엄 네이티브 HTML5 오디오 제어기로 대체) */}
                  {selectedPost.audioUrl && (
                    <div className="audio-viewer-wrapper animate-fade-in">
                      <PremiumAudioPlayer
                        url={selectedPost.audioUrl}
                        title={`${selectedPost.title} (음성 브리핑)`}
                        category={selectedPost.category}
                      />
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
        <p>© 2026 주식 투자 고수방. All rights reserved.</p>
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
              <label className="form-label">학기</label>
              <select
                className="form-select"
                value={newPost.term}
                onChange={(e) => handleNewPostTermChange(e.target.value)}
              >
                {terms.map(term => (
                  <option key={term.id} value={term.id}>{term.title}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">하위 카테고리</label>
              <select
                className="form-select"
                value={newPost.category}
                onChange={(e) => setNewPost({ ...newPost, category: e.target.value })}
              >
                {(getTermCategories(newPost.term).length > 0 ? getTermCategories(newPost.term) : ['언제나 데이트', '굿모닝 담샘', '기업분석도감']).map(categoryId => (
                  <option key={categoryId} value={categoryId}>{categoryMeta[categoryId]?.title || categoryId}</option>
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
