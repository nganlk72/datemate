import React, { useCallback, useState, useEffect } from 'react';
import { X, Star, MessageSquare, Tag, Send, Image as ImageIcon, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchLocationReviews, submitLocationReview } from '../lib/db';
import { supabase } from '../lib/supabase';

const PRESET_TAGS = ['Crowded', 'Chill', 'Loud', 'Cheap', 'Expensive', 'Good Views', 'Great Coffee', 'Historical'];

export default function LocationInsights({ location, myName, onClose }) {
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  
  // Form state
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [imageFiles, setImageFiles] = useState([]); // Up to 4 images
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const locationId = location?.id;

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    const data = await fetchLocationReviews(locationId);
    setReviews(data);
    setIsLoading(false);
  }, [locationId]);

  useEffect(() => {
    if (locationId) {
      loadReviews();
    }
  }, [locationId, loadReviews]);

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleImageChange = (e) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (imageFiles.length + newFiles.length > 4) {
        alert("You can only upload up to 4 images.");
        return;
      }
      setImageFiles([...imageFiles, ...newFiles]);
    }
  };

  const removeImage = (index) => {
    setImageFiles(imageFiles.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!myName) {
      alert("Error: We couldn't find your name. Are you joined to the trip?");
      return;
    }
    
    setIsSubmitting(true);
    try {
      let uploadedUrls = [];
      
      // Upload multiple images to Supabase Storage
      for (const file of imageFiles) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        
        const { error } = await supabase.storage
          .from('reviews')
          .upload(fileName, file);
          
        if (error) {
          console.error("Image upload error:", error);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('reviews')
            .getPublicUrl(fileName);
          uploadedUrls.push(publicUrlData.publicUrl);
        }
      }

      await submitLocationReview(location.id, {
        author_name: myName,
        rating,
        review_text: reviewText,
        tags: selectedTags,
        image_urls: uploadedUrls // Using the new JSONB column
      });
      // Reset form and reload
      setReviewText('');
      setRating(5);
      setSelectedTags([]);
      setImageFiles([]);
      setIsWriting(false);
      await loadReviews();
    } catch (error) {
      console.error(error);
      alert("Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openLightbox = (url) => {
    setLightboxImage(url);
    setZoomLevel(1);
  };

  if (!location) return null;

  // Calculate aggregates
  const avgRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) 
    : 'No ratings yet';
  
  const tagCounts = {};
  reviews.forEach(r => {
    if (r.tags && Array.isArray(r.tags)) {
      r.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });
  const popularTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return (
    <>
      {/* Lightbox Overlay */}
      {lightboxImage && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
          {/* Controls */}
          <div className="absolute top-5 right-5 flex items-center space-x-4 z-50">
            <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.5))} className="text-white hover:text-gray-300 p-2 bg-black/50 rounded-full"><ZoomOut size={24}/></button>
            <span className="text-white font-bold">{Math.round(zoomLevel * 100)}%</span>
            <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.5))} className="text-white hover:text-gray-300 p-2 bg-black/50 rounded-full"><ZoomIn size={24}/></button>
            <button onClick={() => setLightboxImage(null)} className="text-white hover:text-red-400 ml-4 p-2 bg-black/50 rounded-full"><X size={28}/></button>
          </div>
          {/* Image Container */}
          <div className="w-full h-full flex items-center justify-center overflow-auto p-10 cursor-zoom-in" onClick={() => setZoomLevel(z => Math.min(3, z + 0.5))}>
            <img 
              src={lightboxImage} 
              alt="Review full size" 
              style={{ transform: `scale(${zoomLevel})`, transition: 'transform 0.2s ease-out' }}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Backdrop (Transparent so it doesn't dim the map) */}
      <div 
        className="fixed inset-0 bg-transparent z-40"
        onClick={onClose}
      />
      
      {/* Sliding Drawer */}
      <div className="fixed inset-y-0 right-0 w-[450px] bg-white shadow-2xl z-50 transform transition-transform flex flex-col">
        {/* Header */}
        <div className="bg-indigo-600 text-white p-5 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold mb-1">{location.name}</h2>
            <p className="text-indigo-200 capitalize text-sm">{location.category}</p>
          </div>
          <button onClick={onClose} className="text-white hover:bg-indigo-500 p-1 rounded transition">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-gray-50">
          
          {/* Stats Box */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-6 flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium mb-1">Average Rating</p>
              <div className="flex items-center">
                <Star className="text-yellow-400 fill-yellow-400 mr-2" size={24} />
                <span className="text-3xl font-bold text-gray-800">{avgRating}</span>
                {reviews.length > 0 && <span className="text-sm text-gray-400 ml-2">/ 5</span>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-sm font-medium mb-1">Reviews</p>
              <span className="text-xl font-bold text-gray-800">{reviews.length}</span>
            </div>
          </div>

          {/* Popular Tags */}
          {popularTags.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center">
                <Tag size={16} className="mr-2 text-indigo-500"/> Popular Vibes
              </h3>
              <div className="flex flex-wrap gap-2">
                {popularTags.map(tag => (
                  <span key={tag} className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold border border-indigo-100">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <hr className="my-6 border-gray-200" />

          {/* Review Feed */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-700 flex items-center">
                <MessageSquare size={16} className="mr-2 text-indigo-500"/> Member Reviews
              </h3>
              {!isWriting && (
                <button 
                  onClick={() => setIsWriting(true)}
                  className="text-xs bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-200 transition"
                >
                  + Write Review
                </button>
              )}
            </div>

            {/* Write Form */}
            {isWriting && (
              <form onSubmit={handleSubmit} className="bg-white p-4 rounded-xl shadow-sm border border-indigo-200 mb-6 animate-fade-in">
                <h4 className="font-bold text-gray-800 mb-3 text-sm">Your Review</h4>
                
                {/* Star Picker */}
                <div className="flex space-x-1 mb-4">
                  {[1,2,3,4,5].map(num => (
                    <button type="button" key={num} onClick={() => setRating(num)}>
                      <Star size={24} className={num <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"} />
                    </button>
                  ))}
                </div>
                
                {/* Tag Picker */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2 font-medium">Add tags (optional):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TAGS.map(tag => (
                      <button 
                        key={tag} type="button" onClick={() => toggleTag(tag)}
                        className={`text-xs px-2 py-1 rounded-full border transition ${selectedTags.includes(tag) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  value={reviewText}
                  onChange={e => setReviewText(e.target.value)}
                  placeholder="What did you think of this place? (Optional)"
                  className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none mb-3 resize-none"
                  rows="3"
                />
                
                {/* Multiple Image Upload Preview */}
                <div className="mb-4">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {imageFiles.map((file, idx) => (
                      <div key={idx} className="relative w-16 h-16 border rounded-md overflow-hidden group bg-gray-100 flex-shrink-0">
                        <img src={URL.createObjectURL(file)} className="w-full h-full object-contain" alt="preview" />
                        <button type="button" onClick={() => removeImage(idx)} className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity">
                          <X size={12}/>
                        </button>
                      </div>
                    ))}
                    {imageFiles.length < 4 && (
                      <label className="w-16 h-16 border-2 border-dashed border-indigo-300 rounded-md flex flex-col items-center justify-center text-indigo-500 cursor-pointer hover:bg-indigo-50 transition flex-shrink-0">
                        <ImageIcon size={20} />
                        <span className="text-[10px] font-medium mt-1">Add</span>
                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageChange} />
                      </label>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400">{imageFiles.length}/4 photos attached</p>
                </div>
                
                <div className="flex space-x-2">
                  <button type="button" onClick={() => setIsWriting(false)} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-bold text-sm hover:bg-gray-200">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-indigo-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center justify-center">
                    {isSubmitting ? <><Loader2 className="animate-spin mr-2" size={16}/> Saving...</> : <><Send size={16} className="mr-2"/> Post</>}
                  </button>
                </div>
              </form>
            )}

            {/* Review Feed */}
            {isLoading ? (
              <p className="text-center text-sm text-gray-400 py-4">Loading reviews...</p>
            ) : reviews.length === 0 ? (
              <div className="text-center py-6 bg-white rounded-xl border border-dashed border-gray-300">
                <p className="text-gray-500 text-sm mb-2">No reviews yet.</p>
                <button onClick={() => setIsWriting(true)} className="text-indigo-600 font-bold text-sm hover:underline">Be the first to review!</button>
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map(review => {
                  // Handle both the old image_url and the new image_urls array seamlessly
                  const displayImages = review.image_urls || (review.image_url ? [review.image_url] : []);
                  return (
                  <div key={review.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-sm text-gray-800">{review.author_name}</span>
                      <div className="flex">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} size={14} className={i < review.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"} />
                        ))}
                      </div>
                    </div>
                    {review.review_text && (
                      <p className="text-gray-600 text-sm mb-3">{review.review_text}</p>
                    )}
                    
                    {displayImages.length > 0 && (
                      <div className={`grid gap-2 mb-3 ${displayImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {displayImages.map((url, i) => (
                          <div 
                            key={i} 
                            className="bg-gray-100 rounded-lg overflow-hidden border border-gray-200 cursor-zoom-in"
                            onClick={() => openLightbox(url)}
                          >
                            <img src={url} alt="Review attachment" className="w-full h-32 object-contain hover:scale-105 transition-transform" />
                          </div>
                        ))}
                      </div>
                    )}

                    {review.tags && review.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {review.tags.map(tag => (
                          <span key={tag} className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-medium">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
