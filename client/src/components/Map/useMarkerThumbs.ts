import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { fetchPhoto, getAllThumbs, getCached, isLoading, onThumbReady } from '../../services/photoService';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { Place } from '../../types';
import { isCustomPlaceImage, photoCacheKey, photoSourcesKey } from './placePhoto';

/**
 * The small thumbnails the place markers wear, keyed by photoCacheKey, for both
 * the Leaflet and the GL map. Cached thumbs are taken as they are, missing ones
 * are fetched once, and thumbs that arrive together are batched through one
 * animation frame so N photo loads cost a single re-render instead of N.
 *
 * Loading restarts only when a place's picture source changes (photoSourcesKey),
 * not on every new places array, and never while place photos are switched off.
 */
export function useMarkerThumbs(places: Place[]): Record<string, string> {
  // Only base64 thumbs, so the markers stay smooth while the map zooms.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>(getAllThumbs);
  const placesPhotosEnabled = useAuthStore((s) => s.placesPhotosEnabled);
  const markerPhotos = useMarkerPhotos();
  const pendingThumbsRef = useRef<Record<string, string>>({});
  const thumbRafRef = useRef<number | null>(null);
  const photoSources = useMemo(() => photoSourcesKey(places), [places]);

  const startLoading = useEffectEvent((): (() => void) | undefined => {
    if (!places || places.length === 0 || !placesPhotosEnabled || !markerPhotos) return;
    const cleanups: (() => void)[] = [];

    const setThumb = (cacheKey: string, thumb: string) => {
      pendingThumbsRef.current[cacheKey] = thumb;
      if (thumbRafRef.current !== null) return;
      thumbRafRef.current = requestAnimationFrame(() => {
        thumbRafRef.current = null;
        const pending = pendingThumbsRef.current;
        pendingThumbsRef.current = {};
        setPhotoUrls((prev) => {
          const hasChange = Object.entries(pending).some(([k, v]) => prev[k] !== v);
          return hasChange ? { ...prev, ...pending } : prev;
        });
      });
    };

    for (const place of places) {
      // A custom uploaded image is shown directly: never auto-fetch a provider
      // photo for it (the request would 404 for OSM-only places and the fetched
      // thumb would shadow the user's own image). (#1136)
      if (isCustomPlaceImage(place.image_url)) continue;
      const cacheKey = photoCacheKey(place);
      if (!cacheKey) continue;

      const cached = getCached(cacheKey);
      if (cached?.thumbDataUrl) {
        setThumb(cacheKey, cached.thumbDataUrl);
        continue;
      }

      cleanups.push(onThumbReady(cacheKey, (thumb) => setThumb(cacheKey, thumb)));

      if (!cached && !isLoading(cacheKey)) {
        const photoId =
          (place.image_url?.startsWith('/api/maps/place-photo/') ? place.image_url : null) ||
          place.google_place_id ||
          place.osm_id ||
          place.image_url;
        if (photoId || (place.lat && place.lng)) {
          fetchPhoto(cacheKey, photoId || `coords:${place.lat}:${place.lng}`, place.lat, place.lng, place.name);
        }
      }
    }

    return () => {
      cleanups.forEach((fn) => fn());
      if (thumbRafRef.current !== null) {
        cancelAnimationFrame(thumbRafRef.current);
        thumbRafRef.current = null;
      }
    };
  });

  useEffect(() => startLoading(), [photoSources, placesPhotosEnabled, markerPhotos]);

  return photoUrls;
}

/**
 * Whether map markers may wear photos at all — the marker display mode setting.
 * 'categories' asks for the category icon and colour on every marker, so the
 * maps skip both the thumb fetching and the picture on the marker itself.
 * Hover cards and sidebars keep showing photos; this is about marker clarity.
 */
export function useMarkerPhotos(): boolean {
  return useSettingsStore((s) => s.settings.map_marker_mode !== 'categories');
}
