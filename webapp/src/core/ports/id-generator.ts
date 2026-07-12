// IdGenerator — source of unique ids: Account ids (which also name the config
// volume) and Session UUIDs (SESSION_UUID, for remote-control pairing).

export interface IdGenerator {
  newId(): string;
}
