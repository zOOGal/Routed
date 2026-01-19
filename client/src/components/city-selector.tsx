import { MapPin, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CITIES = [
  { id: "nyc", name: "New York City", country: "USA", flag: "US" },
  { id: "tokyo", name: "Tokyo", country: "Japan", flag: "JP" },
  { id: "london", name: "London", country: "UK", flag: "GB" },
];

interface CitySelectorProps {
  selectedCity: string;
  onCityChange: (cityId: string) => void;
}

export function CitySelector({ selectedCity, onCityChange }: CitySelectorProps) {
  const city = CITIES.find((c) => c.id === selectedCity) || CITIES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2" data-testid="button-city-selector">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="font-medium">{city.name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {CITIES.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onCityChange(c.id)}
            className="gap-3"
            data-testid={`menu-item-city-${c.id}`}
          >
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.country}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
