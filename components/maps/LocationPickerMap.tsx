"use client";

import { useEffect, useState, useRef } from "react";
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Search } from "lucide-react";

/** Rich info about a place chosen via the search box (not map click/drag). */
export interface PickedPlace {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  placeId?: string;
}

interface LocationPickerMapProps {
  lat?: number;
  lng?: number;
  onChange: (lat: number, lng: number) => void;
  /** Fires on search-selection with name/address/placeId for form autofill. */
  onPlaceSelect?: (place: PickedPlace) => void;
}

// Default to Tbilisi if no lat/lng provided
const DEFAULT_CENTER = { lat: 41.7151, lng: 44.8271 };

function PlacesAutocomplete({ onPlaceSelect }: { onPlaceSelect: (place: google.maps.places.Place) => void }) {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [sessionToken, setSessionToken] = useState<google.maps.places.AutocompleteSessionToken | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const places = useMapsLibrary("places");
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      if (!places) return;

      // Min 3 chars before any Places request — cheap keystrokes stay free.
      if (value.trim().length < 3) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      let token = sessionToken;
      if (!token) {
        token = new places.AutocompleteSessionToken();
        setSessionToken(token);
      }

      try {
        const response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: token,
        });
        setSuggestions(response.suggestions || []);
        setIsOpen(true);
      } catch (error) {
        console.error("Failed to fetch autocomplete suggestions", error);
      }
    }, 400);
  };

  const handleSelect = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!places || !suggestion.placePrediction) return;

    const placePrediction = suggestion.placePrediction;
    const displayName = placePrediction.text.toString ? placePrediction.text.toString() : (placePrediction.text as any).text;
    
    setInputValue(displayName || "");
    setIsOpen(false);

    try {
      const place = new places.Place({
        id: placePrediction.placeId,
      });

      await place.fetchFields({
        fields: ["location", "viewport", "displayName", "formattedAddress"],
      });

      // Clear the session token after a successful selection to start a new billing session next time
      setSessionToken(null);
      
      onPlaceSelect(place);
    } catch (error) {
      console.error("Failed to fetch place details", error);
    }
  };

  return (
    <div className="absolute top-4 left-4 right-14 z-10" ref={wrapperRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder="Search for your venue or address..."
          className="w-full rounded-xl border border-white/20 bg-zinc-900/90 backdrop-blur shadow-lg px-4 py-2.5 pl-10 text-sm text-white placeholder:text-zinc-500 focus:border-white/40 focus:outline-none transition-all"
        />
        
        {/* Custom Dropdown UI */}
        {isOpen && suggestions.length > 0 && (
          <ul className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden max-h-60 overflow-y-auto">
            {suggestions.map((suggestion, idx) => {
              const prediction = suggestion.placePrediction;
              if (!prediction) return null;
              
              const displayName = prediction.text.toString ? prediction.text.toString() : (prediction.text as any).text;
              
              return (
                <li
                  key={prediction.placeId || idx}
                  onClick={() => handleSelect(suggestion)}
                  className="px-4 py-3 hover:bg-white/10 cursor-pointer transition-colors border-b border-white/5 last:border-b-0"
                >
                  <p className="text-sm font-medium text-white truncate">{displayName}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function MapController({
  position,
  onChange,
  onPlaceSelect,
}: {
  position: google.maps.LatLngLiteral;
  onChange: (lat: number, lng: number) => void;
  onPlaceSelect?: (place: PickedPlace) => void;
}) {
  const map = useMap();

  return (
    <>
      <PlacesAutocomplete
        onPlaceSelect={(place) => {
          if (place.viewport) {
            map?.fitBounds(place.viewport);
          } else if (place.location) {
            map?.setCenter(place.location);
            map?.setZoom(17);
          }
          if (place.location) {
            const lat = place.location.lat();
            const lng = place.location.lng();
            onChange(lat, lng);
            onPlaceSelect?.({
              lat,
              lng,
              name: place.displayName ?? undefined,
              address: place.formattedAddress ?? undefined,
              placeId: place.id,
            });
          }
        }}
      />
      <AdvancedMarker
        position={position}
        draggable={true}
        onDragEnd={(e) => {
          if (e.latLng) {
            onChange(e.latLng.lat(), e.latLng.lng());
          }
        }}
        title="Drag me to your exact location"
      >
        <div className="flex flex-col items-center justify-center -mt-6 cursor-grab active:cursor-grabbing">
          <svg
            width="32"
            height="40"
            viewBox="0 0 32 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-lg"
          >
            {/* Outer Glow / Base */}
            <path
              d="M16 0C7.163 0 0 7.163 0 16C0 26.5 16 40 16 40C16 40 32 26.5 32 16C32 7.163 24.837 0 16 0Z"
              fill="#10B981"
            />
            <path
              d="M16 2.5C8.544 2.5 2.5 8.544 2.5 16C2.5 24.965 16 36.197 16 36.197C16 36.197 29.5 24.965 29.5 16C29.5 8.544 23.456 2.5 16 2.5Z"
              fill="#000"
            />
            {/* Inner dot */}
            <circle cx="16" cy="16" r="6" fill="#10B981" />
          </svg>
        </div>
      </AdvancedMarker>
    </>
  );
}



export function LocationPickerMap({ lat, lng, onChange, onPlaceSelect }: LocationPickerMapProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    setApiKey(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "");
  }, []);

  const position = {
    lat: lat ?? DEFAULT_CENTER.lat,
    lng: lng ?? DEFAULT_CENTER.lng,
  };

  if (!apiKey) {
    return (
      <div className="w-full h-full bg-zinc-900 border border-white/10 flex items-center justify-center rounded-xl">
        <p className="text-[10px] text-white/30 uppercase tracking-widest">Loading Map...</p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} version="weekly">
      <Map
        defaultCenter={position}
        defaultZoom={15}
        disableDefaultUI={false} // Keep UI for the picker
        mapTypeControl={false}
        streetViewControl={false}
        colorScheme="DARK"
        mapId="location-picker-map"
        className="w-full h-full"
        onClick={(e) => {
          // Tap-to-place: drop the pin wherever the map is clicked.
          const ll = e.detail.latLng;
          if (ll) onChange(ll.lat, ll.lng);
        }}
      >
        <MapController
          position={position}
          onChange={onChange}
          onPlaceSelect={onPlaceSelect}
        />
      </Map>
    </APIProvider>
  );
}
