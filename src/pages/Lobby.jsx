import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { joinTrip, saveGeneratedItinerary } from '../lib/db';
import { generateCompromiseItinerary } from '../lib/ai';
import { fetchLocationsFromOverpass } from '../lib/overpass';
import { useLocationSearch, useClickAway } from '../lib/useLocationSearch';
import Icon from '../components/Icon';
import './Lobby.css';

const EMOJIS = ['🌞', '🍜', '🌿', '🎨', '🛵', '✨'];
const ACTIVITIES = ['Cafe', 'Restaurant', 'Outdoors', 'Museum', 'Shopping', 'Park'];
const MODES = [['car', 'Car', 'car'], ['motorcycle', 'Motorbike', 'motorbike'], ['foot', 'Walk', 'walk']];
const STEPS = ["Reading everyone's preferences", 'Finding places near the group', 'Saving your itinerary'];

const FALLBACK_PLACES = [
  { name: 'Hoan Kiem Lake', lat: 21.0289, lon: 105.8522, category: 'attraction' },
  { name: 'Temple of Literature', lat: 21.0294, lon: 105.8355, category: 'attraction' },
  { name: "St. Joseph's Cathedral", lat: 21.0287, lon: 105.8489, category: 'attraction' },
  { name: 'Dong Xuan Market', lat: 21.0379, lon: 105.8509, category: 'market' },
];

function LocationField({ label, placeholder, confirm, search, error, className = '' }) {
  const ref = useRef(null);
  useClickAway(ref, search.closeResults);
  const picked = !!search.selected;
  const message = error || search.error;
  return (
    <div className={`field-group location-field ${className}`} ref={ref}>
      <label>{label}</label>
      <div className={`input-with-icon ${picked ? 'selected-location-input' : ''}`}>
        <Icon name={picked ? 'mapPin' : 'search'} size={17} />
        <input
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder={placeholder}
          aria-label={label}
          className={message && !picked ? 'input-error' : ''}
        />
        {picked && <span className="selected-check">✓</span>}
      </div>
      {search.results.length > 0 && (
        <div className="search-results">
          <span className="results-label">SEARCH RESULTS</span>
          {search.results.map((r, i) => {
            const [title, ...rest] = r.display_name.split(',');
            return (
              <button type="button" key={r.ref_id || i} onClick={() => search.select(r)}>
                <span className="result-icon"><Icon name="mapPin" size={15} /></span>
                <span><strong>{title}</strong>{rest.length > 0 && <small>{rest.join(',').trim()}</small>}</span>
              </button>
            );
          })}
        </div>
      )}
      {picked && <small className="location-confirmation">{confirm}</small>}
      {message && !picked && <small className="field-error">{message}</small>}
    </div>
  );
}

export default function Lobby() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isHost = localStorage.getItem(`host_${id}`) === 'true';

  const [participants, setParticipants] = useState([]);
  const [joinedAs, setJoinedAs] = useState(null); // { name, emoji } once this person has joined
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [showEmojis, setShowEmojis] = useState(false);
  const [budget, setBudget] = useState('300');
  const [transportMode, setTransportMode] = useState('motorcycle');
  const [picked, setPicked] = useState([]);
  const [customList, setCustomList] = useState([]);
  const [custom, setCustom] = useState('');
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [meetupMode, setMeetupMode] = useState('independent');
  const [meetupError, setMeetupError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [genFailed, setGenFailed] = useState(false);

  const start = useLocationSearch();
  const meetup = useLocationSearch();
  const emojiRef = useRef(null);
  const inviteRef = useRef(null);
  const closeEmojis = useCallback(() => setShowEmojis(false), []);
  useClickAway(emojiRef, closeEmojis);

  const hasJoined = !!joinedAs;

  const fetchParticipants = useCallback(async () => {
    const { data } = await supabase.from('trip_participants').select('*').eq('trip_id', id);
    if (data) setParticipants(data);
  }, [id]);

  useEffect(() => {
    fetchParticipants();
    const channel = supabase
      .channel(`lobby_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_participants', filter: `trip_id=eq.${id}` },
        (payload) => setParticipants((cur) => (cur.some((p) => p.id === payload.new.id) ? cur : [...cur, payload.new])))
      .subscribe();

    // Guests: the itinerary exists once trip_locations rows appear
    const tripGenChannel = supabase
      .channel(`trip_gen_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_locations', filter: `trip_id=eq.${id}` },
        () => navigate(`/timeline/${id}`))
      .subscribe();

    const interval = setInterval(async () => {
      fetchParticipants();
      const { data } = await supabase.from('trip_locations').select('location_id').eq('trip_id', id).limit(1);
      if (data && data.length > 0) navigate(`/timeline/${id}`);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(tripGenChannel);
      clearInterval(interval);
    };
  }, [id, fetchParticipants, navigate]);

  const toggleActivity = (a) => setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    const existing = [...ACTIVITIES, ...customList].find((a) => a.toLowerCase() === value.toLowerCase());
    if (!existing) setCustomList((l) => [...l, value]);
    const label = existing || value;
    setPicked((p) => (p.includes(label) ? p : [...p, label]));
    setCustom('');
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    const activities = [...picked];
    const pending = custom.trim();
    if (pending && !activities.some((a) => a.toLowerCase() === pending.toLowerCase())) activities.push(pending);

    const next = {};
    if (!name.trim()) next.name = 'Please add your name to join.';
    if (!start.selected) next.location = 'Pick a starting location from the results.';
    if (!budget) next.budget = 'Enter a budget.';
    if (activities.length === 0) next.activities = 'Pick at least one activity.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setIsSubmitting(true);
    try {
      const cleanName = name.trim();
      await joinTrip(id, {
        name: cleanName,
        avatar_emoji: emoji,
        budget: parseInt(budget, 10) * 1000,
        start_lat: start.selected.lat,
        start_lon: start.selected.lon,
        preferences: { activities, transportMode },
      });
      // Persist identity so the Timeline page knows who this user is
      localStorage.setItem(`name_${id}`, cleanName);
      localStorage.setItem(`emoji_${id}`, emoji);
      setJoinedAs({ name: cleanName, emoji });
      fetchParticipants();
    } catch (error) {
      console.error(error);
      setErrors({ form: "Couldn't join the lobby. Check your connection and try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    if (participants.length === 0) return;
    if (meetupMode === 'meetup' && !meetup.selected) {
      setMeetupError('Pick a meetup spot from the results first.');
      return;
    }
    setMeetupError('');
    setGenFailed(false);
    setGenStep(0);
    setIsGenerating(true);
    try {
      const aiResult = await generateCompromiseItinerary(participants);

      setGenStep(1);
      let places;
      try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
        places = await Promise.race([
          fetchLocationsFromOverpass(aiResult.city, aiResult.categories, aiResult.centroidLat, aiResult.centroidLon),
          timeout,
        ]);
        if (!places || places.length === 0) places = FALLBACK_PLACES;
      } catch {
        places = FALLBACK_PLACES;
      }

      setGenStep(2);
      await saveGeneratedItinerary(
        id,
        places.slice(0, 6),
        aiResult.city,
        meetupMode,
        meetupMode === 'meetup' ? meetup.selected : null,
      );

      setGenStep(3);
      await new Promise((r) => setTimeout(r, 800));
      navigate(`/timeline/${id}`);
    } catch (error) {
      console.error('Generation failed:', error);
      setGenFailed(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      inviteRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isMe = (p) => joinedAs && p.name === joinedAs.name && p.avatar_emoji === joinedAs.emoji;
  const showGenerating = hasJoined && isGenerating;
  const showError = hasJoined && !isGenerating && genFailed;
  const showHost = hasJoined && isHost && !isGenerating && !genFailed;
  const showWaiting = hasJoined && !isHost;
  const inviteText = `${window.location.host}${window.location.pathname}`;

  return (
    <main className="lobby-page">
      <section className="lobby-card">
        <aside className="people-panel">
          <div>
            <span className="overline">GROUP LOBBY</span>
            <h2>Waiting for friends</h2>
            <p>Share the link to invite them</p>
          </div>

          <div className="participant-list">
            <div className="list-heading"><span>WHO'S IN</span><b>{participants.length}</b></div>
            {participants.length === 0 ? (
              <div className="empty-state">No one here yet</div>
            ) : (
              participants.map((p, i) => (
                <div className="participant" key={p.id ?? i}>
                  <span className="avatar">{p.avatar_emoji}</span>
                  <span className="participant-name">
                    <strong>{p.name}</strong>
                    {isMe(p) && isHost && <small>HOST</small>}
                    {isMe(p) && <small className="you-tag">You</small>}
                  </span>
                  <span className="budget-chip">{Math.round(p.budget / 1000)}k VND</span>
                </div>
              ))
            )}
          </div>

          <div className="invite-block">
            <label>INVITE LINK</label>
            <div className="invite-field">
              <Icon name="link" size={16} />
              <input ref={inviteRef} readOnly value={inviteText} aria-label="Invite link" />
              <button type="button" className={copied ? 'copied' : ''} onClick={copyLink}>
                <Icon name="copy" size={14} />{copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <small>Anyone with this link can join your trip.</small>
          </div>
        </aside>

        <section className="form-panel">
          {!hasJoined && (
            <form className="form-content" onSubmit={handleJoin} noValidate>
              <div className="form-heading">
                <span className="step-label">01 · YOUR DETAILS</span>
                <h2>Join the trip</h2>
                <p>Tell the group a little about your day.</p>
              </div>

              <div className="field-group">
                <label>Your name</label>
                <div className="name-row">
                  <div className={`emoji-picker ${showEmojis ? 'force-open' : ''}`} ref={emojiRef}>
                    <button type="button" className="emoji-current" aria-label="Choose avatar" onClick={() => setShowEmojis((s) => !s)}>{emoji}</button>
                    <div className="emoji-menu">
                      {EMOJIS.map((item) => (
                        <button type="button" key={item} onClick={() => { setEmoji(item); setShowEmojis(false); }}>{item}</button>
                      ))}
                    </div>
                  </div>
                  <div className="name-input-wrap">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={errors.name ? 'input-error' : ''}
                      placeholder="What should we call you?"
                      aria-label="Your name"
                      maxLength={30}
                    />
                    {errors.name && <small className="field-error">{errors.name}</small>}
                  </div>
                </div>
              </div>

              <LocationField
                label="Starting location"
                placeholder="Search a place or neighborhood"
                confirm="We'll plan from this starting point."
                search={start}
                error={errors.location}
              />

              <div className="form-row">
                <div className="field-group travel-field">
                  <label>Travel mode</label>
                  <div className="segmented-control">
                    {MODES.map(([value, label, icon]) => (
                      <button type="button" key={value} className={transportMode === value ? 'active' : ''} onClick={() => setTransportMode(value)}>
                        <Icon name={icon} size={16} />{label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field-group budget-field">
                  <label>Budget per person</label>
                  <div className="suffix-input">
                    <input
                      value={budget}
                      onChange={(e) => setBudget(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      aria-label="Budget per person"
                      className={errors.budget ? 'input-error' : ''}
                    />
                    <span>k VND</span>
                  </div>
                  {errors.budget && <small className="field-error">{errors.budget}</small>}
                </div>
              </div>

              <div className="field-group">
                <label>What are you in the mood for?</label>
                <div className="activity-chips">
                  {[...ACTIVITIES, ...customList].map((a) => (
                    <button type="button" key={a} className={picked.includes(a) ? 'active' : ''} onClick={() => toggleActivity(a)}>{a}</button>
                  ))}
                  <input
                    aria-label="Custom activity"
                    placeholder="+ Add your own"
                    value={custom}
                    maxLength={24}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                  />
                </div>
                {errors.activities && <small className="field-error">{errors.activities}</small>}
              </div>

              {errors.form && <small className="field-error">{errors.form}</small>}
              <button className="primary-button" disabled={isSubmitting}>{isSubmitting ? 'Joining…' : 'Join'}</button>
            </form>
          )}

          {showWaiting && (
            <div className="status-content">
              <span className="status-emoji">{joinedAs.emoji}</span>
              <span className="overline">YOU'RE IN</span>
              <h2>You're in</h2>
              <p className="status-count">{participants.length} {participants.length === 1 ? 'traveler' : 'travelers'} in the lobby</p>
              <div className="waiting-note">Waiting for the host to generate the itinerary<span className="dots"><i></i><i></i><i></i></span></div>
            </div>
          )}

          {showHost && (
            <div className="form-content host-content">
              <div className="form-heading">
                <span className="step-label">HOST CONTROLS</span>
                <h2>Ready to make a day of it?</h2>
                <p>Choose how the group should begin.</p>
              </div>
              <div className="host-summary">
                <div>{participants.slice(0, 4).map((p, i) => <span key={p.id ?? i}>{p.avatar_emoji}</span>)}</div>
                <p><strong>{participants.length} {participants.length === 1 ? 'traveler' : 'travelers'}</strong><br />Preferences are ready to match.</p>
              </div>
              <div className="field-group">
                <label>Where should everyone begin?</label>
                <div className="meetup-control">
                  <button type="button" className={meetupMode === 'independent' ? 'active' : ''} onClick={() => { setMeetupMode('independent'); setMeetupError(''); }}>
                    <span className="radio"></span><span><strong>Everyone goes to stop 1</strong><small>Start at the first place on the route</small></span>
                  </button>
                  <button type="button" className={meetupMode === 'meetup' ? 'active' : ''} onClick={() => setMeetupMode('meetup')}>
                    <span className="radio"></span><span><strong>Pick a meetup spot</strong><small>Gather first, then start the itinerary</small></span>
                  </button>
                </div>
              </div>
              {meetupMode === 'meetup' && (
                <LocationField
                  className="meetup-search"
                  label="Meetup location"
                  placeholder="Search for a meetup spot"
                  confirm="Everyone will gather here first."
                  search={meetup}
                  error={meetupError}
                />
              )}
              <button className="primary-button" onClick={handleGenerate}>Generate trip</button>
            </div>
          )}

          {showGenerating && (
            <div className="status-content generating-content">
              <span className="route-loader"><Icon name="route" size={28} /></span>
              <span className="overline">BUILDING YOUR DAY</span>
              <h2>Finding your best route</h2>
              <p>Analysing your group's preferences<span className="dots"><i></i><i></i><i></i></span></p>
              <div className="analysis-list">
                {STEPS.map((label, i) => (
                  i < genStep
                    ? <span key={label} className="done">✓ <b>{label}</b></span>
                    : i === genStep
                      ? <span key={label} className="active"><i className="mini-spinner"></i><b>{label}</b></span>
                      : <span key={label}>○ <b>{label}</b></span>
                ))}
              </div>
              <button className="primary-button loading-button" disabled><i className="spinner"></i>Generating trip</button>
            </div>
          )}

          {showError && (
            <div className="status-content error-content">
              <span className="error-mark">!</span>
              <span className="overline">SOMETHING WENT WRONG</span>
              <h2>We couldn't build the trip</h2>
              <p>Nothing was lost. Check your connection and try generating the itinerary again.</p>
              <button className="primary-button retry-button" onClick={handleGenerate}>Try again</button>
            </div>
          )}
        </section>
      </section>

      <footer className="page-footer"><span>Private by default</span><i></i><span>Links expire after your trip</span></footer>
    </main>
  );
}
