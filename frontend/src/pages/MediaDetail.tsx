import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mediaApi } from '../services/api';
import '../styles/MediaDetail.css';

export default function MediaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [media, setMedia] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMedia = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        setError(null);
        const mediaData = await mediaApi.getById(id);
        setMedia(mediaData);
      } catch (err: any) {
        setError(err.message || 'Failed to load media');
      } finally {
        setLoading(false);
      }
    };

    fetchMedia();
  }, [id]);

  const handleGenerate = () => {
    navigate(`/learning/${id}`);
  };

  // Helper to get image URL
  const getImageUrl = (type: string, title: string): string => {
    // First priority: use imageUrl from the API if available
    if (media?.imageUrl) {
      return media.imageUrl;
    }
    
    const imageMap: Record<string, string[]> = {
      video: [
        'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&h=600&fit=crop',
      ],
      article: [
        'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=1200&h=600&fit=crop',
      ],
      podcast: [
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=600&fit=crop',
      ]
    };
    const images = imageMap[type] || imageMap.article;
    const seed = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return images[seed % images.length];
  };

  if (loading) {
    return (
      <div className="media-detail">
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="media-detail">
        <div className="error-state">{error || 'Media not found'}</div>
      </div>
    );
  }

  return (
    <div className="media-detail">
      <div className="back-link" onClick={() => navigate('/dashboard')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Dashboard
      </div>

      <div className="media-detail-content">
        <div className="media-image-container">
          <img src={getImageUrl(media.type, media.title)} alt={media.title} className="media-detail-image" />
        </div>

        <div className="generate-section">
          <div className="generate-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 4L19 13L28 16L19 19L16 28L13 19L4 16L13 13L16 4Z" stroke="currentColor" strokeWidth="2" fill="none"/>
              <circle cx="20" cy="12" r="2" fill="currentColor"/>
            </svg>
          </div>
          <h2 className="generate-title">Generate Personalized Learning Materials</h2>
          <p className="generate-description">
            Our AI will create a simplified summary, vocabulary list, and a fun fact tailored to your {media.cefr || 'B1'} level. You'll also be able to practice with interactive questions!
          </p>
          <button className="generate-materials-button" onClick={handleGenerate}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" fill="currentColor"/>
            </svg>
            Generate Materials for {media.cefr || 'B1'} Level
          </button>
        </div>
      </div>
    </div>
  );
}
