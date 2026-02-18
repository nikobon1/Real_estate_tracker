export type IdealistaProperty = {
    id: string;
    title: string;
    price: number;
    currency: string;
    size: number; // m2
    rooms: number;
    bathrooms: number;
    latitude: number;
    longitude: number;
    address?: string;
    province?: string;
    city?: string;
    url: string;
    thumbnail?: string;
    constructionYear?: number;
};

export type DatabaseProperty = {
    id: string;
    title: string;
    price: number;
    currency: string;
    size_m2: number;
    rooms: number;
    bathrooms: number;
    location: string; // PostGIS point string
    address: string | null;
    province: string | null;
    city: string | null;
    url: string;
    image_url: string | null;
    year_built: number | null;
};
