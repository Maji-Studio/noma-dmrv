import { COMPOSITION, COMPOSITIONS, type Composition } from './composition-state';
// THROWAWAY: Landscape Atlas, bundled into a single review HTML.
import { useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { LandscapeScene } from './landscape-scene';
import { STEPS, VARIANTS, type Variant } from './process-data';
import './styles.css';
import { PALETTE_STUDIES, type PaletteStudy } from './palette-study';
import { SHADING_STUDIES, readShading, type ShadingMode } from './shading-state';
import majiLogo from './maji-logo.svg';
const ATLAS_VARIANT: Variant = 'A';
function Icon({ type }: {
    type: 'left' | 'right' | 'expand' | 'reset' | 'plus' | 'minus' | 'close';
}) { const paths = { left: 'M17 12H5m6-6-6 6 6 6', right: 'M5 12h12m-6-6 6 6-6 6', expand: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5', reset: 'M4 11a8 8 0 1 1 2 6M4 4v7h7', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'm6 6 12 12M18 6 6 18' }; return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d={paths[type]}/></svg>; }
function App() {
    const [shading, setShading] = useState<ShadingMode>(readShading);
    const [palette, setPalette] = useState<PaletteStudy>(() => { const p = new URLSearchParams(location.search).get('palette'); return p && p in PALETTE_STUDIES ? p as PaletteStudy : 'natural'; });
    const [hovered, setHovered] = useState(-1);
    const [motion, setMotion] = useState(true);
    const [variant] = useState<Variant>(ATLAS_VARIANT);
    const [step, setStep] = useState(-1);
    const [revision, setRevision] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [present, setPresent] = useState(false);
    const [labels, setLabels] = useState(true);
    const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
    function changeComposition(value: Composition) { const url = new URL(location.href); url.searchParams.set('composition', value); location.assign(url.href); }
    function overview() { setStep(-1); setZoom(1); setRevision(r => r + 1); }
    function select(index: number) { setStep(index); setZoom(1); setRevision(r => r + 1); }
    useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    useEffect(() => { const handler = (event: KeyboardEvent) => { const el = event.target as HTMLElement; if (el.matches('input,textarea,select,[contenteditable=true]'))
        return; if (event.key === 'Escape') {
        const settings = document.querySelector<HTMLDetailsElement>('.scene-settings');
        if (settings?.open) {
            settings.open = false;
            settings.querySelector('summary')?.focus();
            return;
        }
        if (present)
            setPresent(false);
        else
            overview();
    } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); });
    useEffect(() => { const handler = () => { setShading(readShading()); const p = new URLSearchParams(location.search).get('palette'); setPalette(p && p in PALETTE_STUDIES ? p as PaletteStudy : 'natural'); overview(); }; window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, []);
    useEffect(() => { const url = new URL(location.href); url.searchParams.set('variant', 'A'); history.replaceState(null, '', url); }, []);
    useEffect(() => { if (step >= 0)
        document.querySelector<HTMLButtonElement>('.stages button[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'instant' : 'smooth' }); }, [step, reduced]);
    const v = VARIANTS[variant], selected = step < 0 ? null : STEPS[step];
    return <main style={{ '--field': PALETTE_STUDIES[palette].ground } as CSSProperties} className={`prototype palette-${palette} variant-${variant}${present ? ' presentation' : ''}${selected ? ' has-selection' : ''}`}>
 <LandscapeScene shading={shading} palette={palette} hovered={hovered} onHover={setHovered} motion={motion} variant={variant} step={step} onSelect={select} revision={revision} zoomFactor={zoom} present={present} reduced={reduced} explode={0} labels={labels}/>
 <header className="masthead"><a className="brand" href={`?variant=A&composition=${COMPOSITION}`} aria-label="Maji landscape overview"><img src={majiLogo} alt="MAJI" width="44" height="44"/></a><span className="identity">The biochar landscape</span></header>
 <section className="intro"><h1>{v.title}</h1><p className="intro-copy">{COMPOSITION === 'atlas' ? v.description : COMPOSITIONS[COMPOSITION].note}</p><label className="composition-control"><span>Scene composition</span><select value={COMPOSITION} onChange={event => changeComposition(event.target.value as Composition)}>{(Object.keys(COMPOSITIONS) as Composition[]).map(key => <option key={key} value={key}>{COMPOSITIONS[key].name}</option>)}</select></label></section>
 <details className="scene-settings"><summary aria-label="Scene settings">View settings <span aria-hidden="true">+</span></summary><div className="settings-panel"><section className="shading-picker" aria-label="Shading studies"><h2>Shading studies</h2>{(Object.keys(SHADING_STUDIES) as ShadingMode[]).map(mode => <button key={mode} aria-pressed={shading === mode} onClick={() => { setShading(mode); const url = new URL(location.href); url.searchParams.set('shading', mode); history.replaceState(null, '', url); }}><span>{SHADING_STUDIES[mode].name}</span><span aria-hidden="true">{shading === mode ? '✓' : ''}</span></button>)}<p>{SHADING_STUDIES[shading].note}</p></section><section className="palette-picker" aria-label="Colour studies"><h2>Landscape colours</h2><div>{(Object.keys(PALETTE_STUDIES) as PaletteStudy[]).map(p => <button key={p} aria-pressed={palette === p} onClick={() => { setPalette(p); const url = new URL(location.href); url.searchParams.set('palette', p); history.replaceState(null, '', url); }}><i style={{ background: PALETTE_STUDIES[p].orange }}/><i style={{ background: PALETTE_STUDIES[p].paper }}/><span>{PALETTE_STUDIES[p].name}</span><span className="palette-check" aria-hidden="true">{palette === p ? '✓' : ''}</span></button>)}</div><p className="palette-note">{PALETTE_STUDIES[palette].note}</p></section><div className="labels-control"><button className="text-button motion-toggle" disabled={reduced} aria-pressed={motion && !reduced} onClick={() => setMotion(m => !m)}><span className={`motion-indicator ${motion && !reduced ? 'running' : ''}`}/>{reduced ? 'Motion reduced' : motion ? 'Pause motion' : 'Play motion'}</button><button className="text-button" onClick={() => setLabels(l => !l)} aria-pressed={labels}>{labels ? 'Hide' : 'Show'} landmarks</button></div></div></details>
 <div className="view-controls"><button onClick={overview} title="Fit the complete landscape"><Icon type="reset"/><span>Overview</span></button><button onClick={() => setZoom(z => Math.max(.65, z / 1.2))} aria-label="Zoom out"><Icon type="minus"/></button><button onClick={() => setZoom(z => Math.min(3, z * 1.2))} aria-label="Zoom in"><Icon type="plus"/></button><button onClick={() => setPresent(p => !p)} title={present ? 'Exit presentation' : 'Presentation view'}><Icon type={present ? 'close' : 'expand'}/><span>{present ? 'Exit' : 'Present'}</span></button></div>
 <p className="map-key">{SHADING_STUDIES[shading].name}<span>Change the finish in View settings</span></p>

 {selected && <aside key={step} className="story selected" aria-live="polite"><div className="story-heading"><span className="mono story-index">{String(step + 1).padStart(2, '0')} / {selected.name}</span><button onClick={overview} aria-label="Close stage details"><Icon type="close"/></button></div><h2>{selected.title}</h2><p>{selected.body}</p><p className="material">{selected.material}</p><button className="next-chapter" onClick={() => step === 5 ? overview() : select(step + 1)}>{step === 5 ? 'Back to landscape' : 'Next stage'}<Icon type="right"/></button></aside>}
 <nav className="stages" aria-label="Process stages">{STEPS.map((s, i) => <button key={s.name} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(-1)} onFocus={() => setHovered(i)} onBlur={() => setHovered(-1)} data-category={i < 3 ? "transformation" : "distribution"} onClick={() => select(i)} aria-pressed={step === i}><span className="step-number">{String(i + 1).padStart(2, '0')}</span><span>{s.short}</span><span className="step-line"/></button>)}</nav>

 {present && selected && <div className="present-caption"><span className="mono">0{step + 1} / {selected.name}</span><h2>{selected.title}</h2><button className="text-button" onClick={() => step === 5 ? overview() : select(step + 1)}>Next step <Icon type="right"/></button></div>}
 </main>;
}
createRoot(document.getElementById('app')!).render(<App />);
