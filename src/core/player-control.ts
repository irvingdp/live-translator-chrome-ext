export type PlayerCandidateKind = 'iframe' | 'video';

export type PlayerControlRequest =
  | {
      type: 'PLAYER_CANDIDATE';
      payload?: { area: number; kind: PlayerCandidateKind };
    }
  | { type: 'PLAYER_TOGGLE' };

export type PlayerControlState = {
  active: boolean;
  busy: boolean;
  error?: string;
};

export type PlayerControlResponse =
  | {
      type: 'PLAYER_SELECTION';
      payload: { selected: boolean; state: PlayerControlState };
    }
  | {
      type: 'PLAYER_STATE';
      payload: PlayerControlState;
    }
  | {
      type: 'PLAYER_TOGGLE_RESULT';
      payload: { error?: string; ok: boolean };
    };
