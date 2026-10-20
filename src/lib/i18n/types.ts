/** Düz metin ya da çoğul gibi seçim için ham parametreleri alan işlev; dönen metindeki {ad} yer tutucuları sonra doldurulur. */
export type Msg = string | ((p: Record<string, unknown>) => string);

export interface Dict {
  [key: string]: Msg | Dict;
}

/** İngilizce sözlüğün Türkçe kaynakla aynı anahtarlara sahip olmasını derleme anında zorlar. */
export type Shape<T> = { [K in keyof T]: T[K] extends Msg ? Msg : Shape<T[K]> };

export type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Msg ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
