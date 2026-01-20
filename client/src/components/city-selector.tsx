import { MapPin, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CITIES = [
  { id: "nyc", name: "New York City", country: "USA" },
  { id: "tokyo", name: "Tokyo", country: "Japan" },
  { id: "berlin", name: "Berlin", country: "Germany" },
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
        <Button 
          variant="ghost" 
          className="gap-2 text-muted-foreground/70 hover:text-foreground font-normal h-auto py-1.5 px-2 -ml-2"
          data-testid="button-city-selector"
        >
          <MapPin className="h-3.5 w-3.5" />
          <span className="text-sm">{city.name}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="start" 
        className="w-48 rounded-xl border-border/50"
      >
        {CITIES.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onCityChange(c.id)}
            className="gap-3 py-2.5 rounded-lg cursor-pointer"
            data-testid={`menu-item-city-${c.id}`}
          >
            <MapPin className="h-3.5 w-3.5 text-muted-foreground/50" />
            <div className="flex flex-col">
              <span className="text-sm">{c.name}</span>
              <span className="text-xs text-muted-foreground/50">{c.country}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
