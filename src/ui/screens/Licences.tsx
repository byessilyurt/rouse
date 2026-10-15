/** Open-source licences (design.md §3.14 About). Bundled text only; no network. */
import { Screen } from '../components/layout';
import { goBack } from '../router';

const MIT = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ENTRIES: { name: string; licence: string; text: string }[] = [
  { name: 'Rouse', licence: 'MIT', text: MIT('Rouse contributors') },
  { name: 'Preact', licence: 'MIT', text: MIT('2015-present Jason Miller') },
  { name: 'Capacitor', licence: 'MIT', text: MIT('2017-present Drifty Co.') },
  {
    name: 'jsQR',
    licence: 'Apache-2.0',
    text: 'Copyright 2017 Cosmo Wolfe.\n\nLicensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
  },
  {
    name: 'Alarm sounds',
    licence: 'CC0 1.0',
    text: 'The bundled tones are synthesised by Rouse from simple recipes and dedicated to the public domain (CC0 1.0). Icons are original drawings, MIT like the rest of Rouse.',
  },
];

export function LicencesScreen() {
  return (
    <Screen title="Licences" chrome="top" onBack={() => goBack('/settings')}>
      {ENTRIES.map((e) => (
        <section class="section licence" key={e.name} aria-labelledby={`lic-${e.name.replace(/\s/g, "-")}`}>
          <h2 id={`lic-${e.name.replace(/\s/g, '-')}`}>
            {e.name} · {e.licence}
          </h2>
          <pre>{e.text}</pre>
        </section>
      ))}
    </Screen>
  );
}
