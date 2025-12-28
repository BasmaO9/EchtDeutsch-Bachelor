import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { mediaApi, userProfileApi, type MediaItem as ApiMediaItem } from '../services/api';
import { authService } from '../services/auth';
import SharedHeader from '../components/SharedHeader';
import dwLogo from '../assets/dw.jpg';
import ytLogo from '../assets/yt.png';
import liechtLogo from '../assets/liecht.jpg';
import '../styles/Dashboard.css';

interface DisplayMediaItem {
  id: string;
  title: string;
  description: string;
  level: string;
  source: string;
  category: string;
  topic: string; // English topic for display
  type: 'article' | 'video' | 'podcast';
  imageUrl: string;
  sourceUrl: string;
  visibility: 'global' | 'private'; // Visibility status
}

// Helper function to extract source from URL only
const extractSource = (sourceUrl: string): string | null => {
  if (sourceUrl) {
    if (sourceUrl.includes('dw.com') || sourceUrl.includes('deutsche-welle')) {
      return 'DW';
    }
    if (sourceUrl.includes('zdf.de')) {
      return 'ZDF';
    }
    if (sourceUrl.includes('easygerman')) {
      return 'Easy German';
    }
  }
  return null; // Return null instead of 'Unknown'
};

// Helper function to translate topic to English (for display)
const translateTopicToEnglish = (topic: string): string => {
  const topicMap: Record<string, string> = {
    'politics': 'Politics',
    'sports': 'Sports',
    'technology': 'Technology',
    'culture': 'Culture',
    'science': 'Science',
    'business': 'Business',
    'health': 'Health',
    'environment': 'Environment',
    'education': 'Education',
    'travel': 'Travel',
    'food': 'Food',
    'entertainment': 'Entertainment',
    'news': 'News',
    'general': 'General',
  };
  
  if (topic) {
    const lowerTopic = topic.toLowerCase();
    return topicMap[lowerTopic] || topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  return 'General';
};

// Helper function to generate description from transcript or title
const getDescription = (transcript: string | undefined, title: string): string => {
  if (transcript && transcript.length > 0) {
    // Take first 100 characters of transcript
    const shortTranscript = transcript.substring(0, 100);
    return shortTranscript + (transcript.length > 100 ? '...' : '');
  }
  // Generate a generic description from title
  return `Lernen Sie mehr über ${title.toLowerCase()}`;
};

const thumbnailOverrides: Record<string, string> = {
  bayern: '/thumbnails/bayern-munich.jpg',
};

const extractYoutubeId = (url?: string) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.includes('/embed/')) {
        return parsed.pathname.split('/embed/')[1]?.split(/[?/]/)[0] || null;
      }
      return parsed.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
};

const getDefaultImage = (type: string, title: string): string => {
  const imageMap: Record<string, string[]> = {
    video: [
      'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&h=400&fit=crop',
    ],
    article: [
      'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800&h=400&fit=crop',
    ],
    podcast: [
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=400&fit=crop',
      'https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&h=400&fit=crop',
    ],
  };
  const images = imageMap[type] || imageMap.article;
  const seed = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return images[seed % images.length];
};

const resolveThumbnail = (item: ApiMediaItem) => {
  // First priority: use imageUrl from the API if available
  if (item.imageUrl) {
    return item.imageUrl;
  }
  
  const normalizedTitle = item.title.toLowerCase();
  for (const key of Object.keys(thumbnailOverrides)) {
    if (normalizedTitle.includes(key)) {
      return thumbnailOverrides[key];
    }
  }
  const ytId = extractYoutubeId(item.sourceUrl);
  if (ytId) {
    return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  }
  return getDefaultImage(item.type, item.title);
};

// Convert API media item to display format
const convertToDisplayItem = (apiItem: ApiMediaItem): DisplayMediaItem => {
  const topicFromDb = apiItem.topic || '';
  const translatedTopic = translateTopicToEnglish(topicFromDb);
  
  return {
    id: apiItem._id,
    title: apiItem.title,
    description: getDescription(apiItem.transcript, apiItem.title),
    level: apiItem.cefr || 'B1',
    source: extractSource(apiItem.sourceUrl || '') || '',
    category: translatedTopic, // For grouping
    topic: translatedTopic, // For display above title
    type: apiItem.type,
    imageUrl: resolveThumbnail(apiItem),
    sourceUrl: apiItem.sourceUrl || '',
    visibility: apiItem.visibility || 'global' // Include visibility
  };
};

// Helper function to get type icon
const getTypeIcon = (type: string) => {
  switch (type) {
    case 'video':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2L13 8L3 14V2Z" fill="currentColor"/>
        </svg>
      );
    case 'podcast':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
        </svg>
      );
    case 'article':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2H13V14H3V2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <path d="M5 5H11M5 8H11M5 11H9" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      );
    default:
      return null;
  }
};

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'video' | 'article'>('all');
  const [mediaItems, setMediaItems] = useState<DisplayMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [userCefr, setUserCefr] = useState<string>('B1'); // Default to B1
  const [userName, setUserName] = useState<string>('Learner'); // Default name
  const [userInterests, setUserInterests] = useState<string[]>([]); // User interests
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Scraper state
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeSuccess, setScrapeSuccess] = useState(false);

  // Calculate floating logo positions once using useRef - completely isolated from any state changes
  // This ensures they are NEVER recalculated, even on re-renders caused by button presses or user actions
  const floatingLogosRef = useRef<Array<{
    key: number;
    logo: string;
    logoName: string;
    leftPos: string;
    topPos: string;
    size: number;
    animationDelay: string;
    animationDuration: string;
  }> | null>(null);

  // Lazy initialization - only runs once, never again
  if (floatingLogosRef.current === null) {
    floatingLogosRef.current = [...Array(250)].map((_, i) => {
      const logos = [dwLogo, ytLogo, liechtLogo];
      const logo = logos[i % 3];
      const logoName = i % 3 === 0 ? 'dw' : i % 3 === 1 ? 'yt' : 'liecht';
      
      // Fully random positioning across the entire viewport
      // Use random values between 0-100% with some margin to avoid edges
      const leftPos = `${2 + Math.random() * 96}%`;
      const topPos = `${2 + Math.random() * 96}%`;
      
      // Varied sizes for more visual interest (60% to 140% of base size)
      const sizeVariation = 0.6 + (Math.random() * 0.8);
      
      // More varied animation delays and durations for natural movement
      const animationDelay = `${Math.random() * 20}s`;
      const animationDuration = `${8 + Math.random() * 12}s`;
      
      return {
        key: i,
        logo,
        logoName,
        leftPos,
        topPos,
        size: sizeVariation,
        animationDelay,
        animationDuration,
      };
    });
  }

  // Use the ref value - this will always be the same array, never recalculated
  const floatingLogos = floatingLogosRef.current;

  useEffect(() => {
    // Get username from auth service
    const user = authService.getUser();
    if (user && user.username) {
      setUserName(user.username);
    }

    const fetchUserProfile = async () => {
      try {
        const profile = await userProfileApi.getProfile();
        if (profile && profile.cefr) {
          setUserCefr(profile.cefr);
        }
        // Extract name if available, or use username from auth
        if (profile && (profile as any).name) {
          setUserName((profile as any).name);
        }
        // Extract interests if available
        if (profile && (profile as any).interests && Array.isArray((profile as any).interests)) {
          setUserInterests((profile as any).interests);
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
        // Keep default B1 if fetch fails
      }
    };

    fetchUserProfile();
  }, []);


  useEffect(() => {
    const fetchMedia = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await mediaApi.getAll();
        const convertedItems = data.map(convertToDisplayItem);
        setMediaItems(convertedItems);
      } catch (err) {
        setError('Failed to load media. Please try again later.');
        console.error('Error fetching media:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMedia();
  }, []);

  const filteredItems = mediaItems.filter(item => {
    const matchesSearch = 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.source && item.source.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesType = selectedType === 'all' || item.type === selectedType;
    
    return matchesSearch && matchesType;
  });

  // Separate items by visibility
  const globalItems = filteredItems.filter(item => item.visibility === 'global');
  const privateItems = filteredItems.filter(item => item.visibility === 'private');

  // Filter by selected category for global items
  const categoryFilteredGlobalItems = selectedCategory === 'all' 
    ? globalItems 
    : globalItems.filter(item => item.category === selectedCategory);

  // Helper function to get allowed CEFR levels based on user's CEFR level
  const getAllowedCefrLevels = (userLevel: string): string[] => {
    const levelMap: Record<string, string[]> = {
      'A1': ['A1', 'A2', 'B1'],
      'A2': ['A1', 'A2', 'B1'],
      'B1': ['A2', 'B1', 'B2'],
      'B2': ['B1', 'B2', 'C1'],
      'C1': ['B2', 'C1', 'C2'],
      'C2': ['B2', 'C1', 'C2'],
    };
    return levelMap[userLevel] || ['B1', 'B2']; // Default fallback
  };

  // Map user interests to topic categories
  const mapInterestToTopic = (interest: string): string | null => {
    const interestMap: Record<string, string> = {
      'Travel': 'Travel',
      'Culture': 'Culture',
      'Technology': 'Technology',
      'Environment/Climate': 'Environment',
      'Business': 'Business',
      'Food': 'Food',
      'Sports': 'Sports',
      'Student Life': 'Education',
      'Science': 'Science',
    };
    return interestMap[interest] || null;
  };

  // Get allowed CEFR levels for the user
  const allowedCefrLevels = getAllowedCefrLevels(userCefr);
  
  // Get topics that match user interests
  const matchingTopics = userInterests
    .map(mapInterestToTopic)
    .filter((topic): topic is string => topic !== null);

  // Filter recommended items: must match interests AND CEFR level
  const recommendedItems = categoryFilteredGlobalItems.filter(item => {
    const matchesInterest = matchingTopics.length > 0 && matchingTopics.includes(item.category);
    const matchesCefr = allowedCefrLevels.includes(item.level);
    return matchesInterest && matchesCefr;
  });

  // Filter explore items: all items that are NOT in recommended
  const exploreItems = categoryFilteredGlobalItems.filter(item => {
    const matchesInterest = matchingTopics.length > 0 && matchingTopics.includes(item.category);
    const matchesCefr = allowedCefrLevels.includes(item.level);
    return !(matchesInterest && matchesCefr);
  });

  const handleGenerateMaterials = (itemId: string) => {
    navigate(`/learning/${itemId}`);
  };

  const handleScrapeArticle = async () => {
    if (!scrapeUrl.trim()) {
      setScrapeError('Please enter a URL');
      return;
    }

    setScraping(true);
    setScrapeError(null);
    setScrapeSuccess(false);

    try {
      await mediaApi.scrapeArticle(scrapeUrl.trim());
      setScrapeSuccess(true);
      setScrapeUrl('');
      
      // Refresh the media list
      const data = await mediaApi.getAll();
      const convertedItems = data.map(convertToDisplayItem);
      setMediaItems(convertedItems);
      
      // Clear success message after 3 seconds
      setTimeout(() => setScrapeSuccess(false), 3000);
    } catch (err: any) {
      setScrapeError(err.message || 'Failed to scrape article/video. Please check the URL and try again.');
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="dashboard-modern">
      {/* Floating Background Logos */}
      <div className="floating-background-logos">
        {floatingLogos.map((logoData) => (
          <div
            key={logoData.key}
            className={`floating-logo floating-logo-${logoData.logoName}`}
            style={{
              left: logoData.leftPos,
              top: logoData.topPos,
              animationDelay: logoData.animationDelay,
              animationDuration: logoData.animationDuration,
              transform: `scale(${logoData.size})`,
            }}
          >
            <img src={logoData.logo} alt={logoData.logoName} />
          </div>
        ))}
      </div>

      <SharedHeader />

      <main className="dashboard-main-modern">
        {/* Logo and Motto Section */}
        <div className="login-header">
          <h1 className="login-brand-title">EchtDeutsch</h1>
          <p className="login-motto">Learn German beyond the textbook!</p>
        </div>

        {/* Personalized Greeting Section */}
        <div className="greeting-section">
          <h1 className="greeting-title">
            Hallo, <span className="greeting-name">{userName}</span>
          </h1>
        </div>

        {/* User Guide Section */}
        <div className="user-guide-section">
          <div className="guide-box guide-box-first">
            <div className="guide-box-icon">📚</div>
            <div className="guide-box-number">1</div>
            <div className="guide-box-content">
              <h3 className="guide-box-title">Choose a media piece</h3>
              <p className="guide-box-description">Pick the article or video you want to explore OR scroll to the bottom to add your custom media pieces from nachrichtenleicht, DW or YouTube!</p>
            </div>
            <div className="guide-box-arrow">↓</div>
          </div>
          <div className="guide-box">
            <div className="guide-box-icon">💡</div>
            <div className="guide-box-number">2</div>
            <div className="guide-box-content">
              <h3 className="guide-box-title">Review the scaffold takeaways</h3>
              <p className="guide-box-description">Open the generated scaffold: summary, key vocabulary, natural expressions and a culture nugget - these highlight the most useful learning points.</p>
            </div>
          </div>
          <div className="guide-box">
            <div className="guide-box-icon">👀</div>
            <div className="guide-box-number">3</div>
            <div className="guide-box-content">
              <h3 className="guide-box-title">Read or watch the original</h3>
              <p className="guide-box-description">Read the full text or watch the video. Completing this step unlocks the evaluation phase so you can take a mini quiz.</p>
            </div>
          </div>
          <div className="guide-box">
            <div className="guide-box-icon">✅</div>
            <div className="guide-box-number">4</div>
            <div className="guide-box-content">
              <h3 className="guide-box-title">Evaluate yourself by goal</h3>
              <p className="guide-box-description">Take the short evaluation (flashcards / MCQs / fill-in-the-blanks) that matches your learning goal. You can change your goal any time via the arrow at the top of the page.</p>
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="category-section">
          <div className="category-header">
            <h2 className="category-title">
              Authentische Medienbibliothek
              <span className="section-subtitle">Authentic Media Library</span>
            </h2>
          </div>
          <div className="category-tabs">
            <button
              className={`category-tab ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              All
            </button>
            {Array.from(new Set(globalItems.map(item => item.category)))
              .sort()
              .map((topic) => (
                <button
                  key={topic}
                  className={`category-tab ${selectedCategory === topic ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(topic)}
                >
                  {topic}
                </button>
              ))}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="search-filters-section">
          <div className="search-wrapper">
            <svg className="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2"/>
              <path d="M15 15L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              className="search-input-modern"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="type-filters">
            <button
              className={`type-filter ${selectedType === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedType('all')}
            >
              All
            </button>
            <button
              className={`type-filter ${selectedType === 'video' ? 'active' : ''}`}
              onClick={() => setSelectedType('video')}
            >
              Videos
            </button>
            <button
              className={`type-filter ${selectedType === 'article' ? 'active' : ''}`}
              onClick={() => setSelectedType('article')}
            >
              Articles
            </button>
          </div>
        </div>

        {loading && (
          <div className="loading-state">
            <p>Loading media...</p>
          </div>
        )}

        {error && (
          <div className="error-state">
            <p>{error}</p>
          </div>
        )}

        {/* Content Grid */}
        {loading && (
          <div className="loading-state-modern">
            <div className="loading-spinner"></div>
            <p>Loading your content...</p>
          </div>
        )}

        {error && (
          <div className="error-state-modern">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {categoryFilteredGlobalItems.length === 0 ? (
              <div className="empty-state-modern">
                <div className="empty-icon">📚</div>
                <p>No content found matching your criteria.</p>
              </div>
            ) : (
              <div className="content-grid-modern">
                {/* Recommended for you section */}
                {recommendedItems.length > 0 && (
                  <div className="topic-section-modern">
                    <div className="topic-section-header">
                      <h2 className="topic-section-title">
                        Für Sie empfohlen
                        <span className="section-subtitle">Recommended for you</span>
                      </h2>
                    </div>
                    <div className="content-cards-grid">
                      {recommendedItems.map((item, index) => (
                        <div 
                          key={item.id} 
                          className="content-card-modern"
                          style={{ animationDelay: `${index * 0.1}s` }}
                        >
                          <div className="content-card-image-wrapper">
                            <img src={item.imageUrl} alt={item.title} className="content-card-image" />
                            <div className="content-card-overlay">
                              <div className="content-level-badge">{item.level}</div>
                              <div className="content-type-badge">
                                {getTypeIcon(item.type)}
                              </div>
                            </div>
                          </div>
                          <div className="content-card-body">
                            {item.sourceUrl && (
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="content-source-button"
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M6 2H3C2.44772 2 2 2.44772 2 3V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V10M10 2H14M14 2V6M14 2L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Source
                              </a>
                            )}
                            {item.topic && (
                              <div className="content-topic-badge">{item.topic}</div>
                            )}
                            <h3 className="content-card-title">{item.title}</h3>
                            <p className="content-card-description">{item.description}</p>
                            <button
                              className="content-card-button"
                              onClick={() => handleGenerateMaterials(item.id)}
                            >
                              Explore content
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Explore others section */}
                {exploreItems.length > 0 && (
                  <div className="topic-section-modern">
                    <div className="topic-section-header">
                      <h2 className="topic-section-title">
                        Weitere entdecken
                        <span className="section-subtitle">Explore others</span>
                      </h2>
                    </div>
                    <div className="content-cards-grid">
                      {exploreItems.map((item, index) => (
                        <div 
                          key={item.id} 
                          className="content-card-modern"
                          style={{ animationDelay: `${index * 0.1}s` }}
                        >
                          <div className="content-card-image-wrapper">
                            <img src={item.imageUrl} alt={item.title} className="content-card-image" />
                            <div className="content-card-overlay">
                              <div className="content-level-badge">{item.level}</div>
                              <div className="content-type-badge">
                                {getTypeIcon(item.type)}
                              </div>
                            </div>
                          </div>
                          <div className="content-card-body">
                            {item.sourceUrl && (
                              <a
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="content-source-button"
                              >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M6 2H3C2.44772 2 2 2.44772 2 3V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V10M10 2H14M14 2V6M14 2L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Source
                              </a>
                            )}
                            {item.topic && (
                              <div className="content-topic-badge">{item.topic}</div>
                            )}
                            <h3 className="content-card-title">{item.title}</h3>
                            <p className="content-card-description">{item.description}</p>
                            <button
                              className="content-card-button"
                              onClick={() => handleGenerateMaterials(item.id)}
                            >
                              Explore content
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Add Content Section - Moved to Bottom (Secondary Feature) */}
        <div className="add-content-section-top">
          <div className="add-content-box-top">
            <h3 className="add-content-title-top">
              Neuen Inhalt hinzufügen
              <span className="section-subtitle">Add New Content</span>
            </h3>
            <p className="add-content-description-top">
              <span className="text-english">
                This platform currently supports adding content like articles from{' '}
                <a 
                  href="https://www.nachrichtenleicht.de/nachrichtenleicht-nachrichten-100.html" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="source-link-button source-link-nachrichtenleicht"
                  title="Click to visit nachrichtenleicht"
                >
                  nachrichtenleicht
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
                    <path d="M11 3V1M11 1H9M11 1L4 8M6 1H2C1.44772 1 1 1.44772 1 2V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
                {' '}or{' '}
                <a 
                  href="https://www.dw.com/de/themen/s-9077" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="source-link-button source-link-dw"
                  title="Click to visit Deutsche Welle"
                >
                  DW
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
                    <path d="M11 3V1M11 1H9M11 1L4 8M6 1H2C1.44772 1 1 1.44772 1 2V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
                {' '}and german videos (Max. 15 minutes) from{' '}
                <a 
                  href="https://www.youtube.com/results?search_query=deutsch+youtube" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="source-link-button source-link-youtube"
                  title="Click to visit YouTube"
                >
                  YouTube
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }}>
                    <path d="M11 3V1M11 1H9M11 1L4 8M6 1H2C1.44772 1 1 1.44772 1 2V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
                {' '}
              </span>
            </p>
            <div className="add-content-input-group-top">
              <input
                type="text"
                className="add-content-input-top"
                placeholder="z.B. https://www.nachrichtenleicht.de/... oder https://www.dw.com/... oder https://www.youtube.com/... | e.g., https://www.nachrichtenleicht.de/... or https://www.dw.com/... or https://www.youtube.com/..."
                value={scrapeUrl}
                onChange={(e) => {
                  setScrapeUrl(e.target.value);
                  setScrapeError(null);
                  setScrapeSuccess(false);
                }}
                disabled={scraping}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !scraping && scrapeUrl.trim()) {
                    handleScrapeArticle();
                  }
                }}
              />
              <button
                className="add-content-button-top"
                onClick={handleScrapeArticle}
                disabled={scraping || !scrapeUrl.trim()}
              >
                {scraping ? 'Hinzufügen...' : 'Hinzufügen'}
                {scraping ? ' | Adding...' : ' | Add'}
              </button>
            </div>
            {scrapeError && <div className="add-content-message-top error">{scrapeError}</div>}
            {scrapeSuccess && (
              <div className="add-content-message-top success">
                Inhalt erfolgreich hinzugefügt! | Content added successfully!
              </div>
            )}
          </div>
        </div>

        {/* My Added Media Section - Moved below Add Content */}
        {!loading && privateItems.length > 0 && (
          <div className="my-added-media-section">
            <h2 className="my-added-media-title">My Added Media</h2>
            <div className="my-added-media-grid">
              {privateItems.map((item, index) => (
                <div 
                  key={item.id} 
                  className="content-card-modern"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="content-card-image-wrapper">
                    <img src={item.imageUrl} alt={item.title} className="content-card-image" />
                    <div className="content-card-overlay">
                      <div className="content-level-badge">{item.level}</div>
                      <div className="content-type-badge">
                        {getTypeIcon(item.type)}
                      </div>
                    </div>
                  </div>
                  <div className="content-card-body">
                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="content-source-button"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6 2H3C2.44772 2 2 2.44772 2 3V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V10M10 2H14M14 2V6M14 2L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Source
                      </a>
                    )}
                    {item.topic && (
                      <div className="content-topic-badge">{item.topic}</div>
                    )}
                    <h3 className="content-card-title">{item.title}</h3>
                    <p className="content-card-description">{item.description}</p>
                    <button
                      className="content-card-button"
                      onClick={() => handleGenerateMaterials(item.id)}
                    >
                      Explore content
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
