/** Typing mission (design.md §3.7 Typing): no copy/paste, first mismatch marked with ▲ (not colour only). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TypingMissionConfig } from '../../core/types';
import { comparePhrase, normalizePhrase, pickPhrases } from '../../missions/typing';
import { Button } from '../components/Button';
import { Card } from '../components/layout';
import { announce } from '../components/feedback';
import { Feedback, useFeedback, type MissionProps } from './common';

export function TypingMission({ config, rng, onSuccess, onFailure, onActivity, onProgress }: MissionProps<TypingMissionConfig>) {
  const phrases = useMemo(() => pickPhrases(config, rng), []);
  const [p, setP] = useState(0);
  const [typed, setTyped] = useState('');
  const [fb, setFb] = useFeedback();
  const [pasteMsg, setPasteMsg] = useState(false);
  const [showMark, setShowMark] = useState(false);
  const done = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => onProgress(Math.min(p + 1, phrases.length), phrases.length), [p]);

  const phrase = phrases[p] ?? '';
  const shown = normalizePhrase(phrase, true);
  const expectedNorm = normalizePhrase(phrase, config.strictCase);
  const typedNorm = normalizePhrase(typed, config.strictCase);
  const check = comparePhrase(phrase, typed, config.strictCase);
  const k = Math.min(check.correctPrefixLength, expectedNorm.length);
  const mismatchAt = typedNorm.length > k && k < shown.length ? k : null;
  const ready = typedNorm.length >= expectedNorm.length;

  const submit = () => {
    onActivity();
    if (!ready || done.current) return;
    if (comparePhrase(phrase, typed, config.strictCase).matches) {
      setFb(null);
      setShowMark(false);
      if (p + 1 >= phrases.length) {
        done.current = true;
        onSuccess();
      } else {
        setP(p + 1);
        setTyped('');
        taRef.current?.focus();
      }
    } else {
      setShowMark(true);
      setFb("A few characters don't match. Look for the ▲ mark.");
      onFailure('typing-mismatch');
    }
  };

  const mark = showMark || (mismatchAt !== null && typedNorm.length >= Math.min(expectedNorm.length, k + 3));

  return (
    <div class="mission-content">
      <Card>
        <p class="phrase-card" onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} data-testid="typing-phrase">
          {mark && mismatchAt !== null ? (
            <>
              {shown.slice(0, mismatchAt)}
              <span class="mismatch">
                {shown.slice(mismatchAt, mismatchAt + 1) || ' '}
                <span class="marker" aria-hidden="true">
                  ▲
                </span>
              </span>
              {shown.slice(mismatchAt + 1)}
              <span class="visually-hidden">. First difference at character {mismatchAt + 1}.</span>
            </>
          ) : (
            shown
          )}
        </p>
      </Card>
      <div class="field">
        <label for="typing-input">Type the phrase</label>
        <textarea
          id="typing-input"
          ref={taRef}
          class="textarea"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck={false}
          value={typed}
          aria-describedby="typing-progress"
          onInput={(e) => {
            onActivity();
            setPasteMsg(false);
            setTyped((e.currentTarget as HTMLTextAreaElement).value);
          }}
          onPaste={(e) => {
            e.preventDefault();
            setPasteMsg(true);
            announce("Type it, don't paste it.", 'assertive');
          }}
          onDrop={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <p class="muted small" id="typing-progress" aria-live="off">
          {k} of {expectedNorm.length} characters correct
        </p>
        {pasteMsg && <p class="error-text">Type it, don't paste it.</p>}
      </div>
      <Feedback text={fb.text} k={fb.key} />
      <Button variant="primary" size="ring" block ariaDisabled={!ready} onClick={submit}>
        Check
      </Button>
    </div>
  );
}
