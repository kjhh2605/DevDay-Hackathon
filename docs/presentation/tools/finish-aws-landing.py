"""Preserve native one-click builds and apply quiet, editable table borders."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from hashlib import sha256
import json
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / '.local/presentation/aws-landing-revision'
SOURCE = ROOT / 'docs/presentation/output/말모아_10분_프로젝트발표_편집가능.pptx'
NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
P, A = NS['p'], NS['a']
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
plans = {p['slide']: p for p in json.loads((BUILD / 'animation-plan.json').read_text())}
with ZipFile(SOURCE) as source:
    template = E.fromstring(source.read('ppt/slides/slide1.xml')).find('p:timing', NS)
    assert template is not None, 'Original opening Appear timing missing'

report = {'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': sha256(SOURCE.read_bytes()).hexdigest(),
          'slideCount': 13, 'nativeTables': [], 'clickBuilds': [], 'nativeDiagrams': []}

with ZipFile(BUILD / 'candidate.pptx') as src, ZipFile(BUILD / 'candidate-animated.pptx', 'w', ZIP_DEFLATED) as out:
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename.startswith('ppt/slides/slide') and item.filename.endswith('.xml'):
            number = int(item.filename.rsplit('slide', 1)[1].split('.')[0])
            xml = E.fromstring(data)
            for table in xml.findall('.//a:tbl', NS):
                for row_index, row in enumerate(table.findall('a:tr', NS)):
                    for cell in row.findall('a:tc', NS):
                        prop = cell.find('a:tcPr', NS)
                        if prop is None:
                            prop = E.SubElement(cell, f'{{{A}}}tcPr')
                        for side in reversed(['lnL', 'lnR', 'lnT', 'lnB', 'lnTlToBr', 'lnBlToTr']):
                            old = prop.find(f'a:{side}', NS)
                            if old is not None:
                                prop.remove(old)
                            ln = E.Element(f'{{{A}}}{side}', w='6350')
                            if side == 'lnB':
                                fill = E.SubElement(ln, f'{{{A}}}solidFill')
                                E.SubElement(fill, f'{{{A}}}srgbClr', val='DCCCFF' if row_index == 0 else 'E3E3E3')
                                E.SubElement(ln, f'{{{A}}}prstDash', val='solid')
                            else:
                                E.SubElement(ln, f'{{{A}}}noFill')
                            prop.insert(0, ln)
                        if row_index == 0:
                            sf = prop.find('a:solidFill', NS)
                            if sf is not None:
                                prop.remove(sf)
                            sf = E.SubElement(prop, f'{{{A}}}solidFill')
                            E.SubElement(sf, f'{{{A}}}srgbClr', val='5431A6')
                            for run in cell.findall('.//a:rPr', NS) + cell.findall('.//a:defRPr', NS):
                                for old in run.findall('a:solidFill', NS):
                                    run.remove(old)
                                sf = E.Element(f'{{{A}}}solidFill')
                                run.insert(0, sf)
                                E.SubElement(sf, f'{{{A}}}srgbClr', val='FFFFFF')
                report['nativeTables'].append(number)
            if number in plans:
                tree = xml.find('p:cSld/p:spTree', NS)
                marker = plans[number]['coverName']
                children = list(tree)
                start = next(i for i, child in enumerate(children)
                             if (child.find('.//p:cNvPr', NS) is not None
                                 and child.find('.//p:cNvPr', NS).get('name') == marker))
                target_id = max(int(v.get('id')) for v in xml.findall('.//p:cNvPr', NS)) + 1
                group = E.Element(f'{{{P}}}grpSp')
                nv = E.SubElement(group, f'{{{P}}}nvGrpSpPr')
                E.SubElement(nv, f'{{{P}}}cNvPr', id=str(target_id), name=f'한 번 클릭하여 다음 화면 - {number}')
                E.SubElement(nv, f'{{{P}}}cNvGrpSpPr')
                E.SubElement(nv, f'{{{P}}}nvPr')
                props = E.SubElement(group, f'{{{P}}}grpSpPr')
                transform = E.SubElement(props, f'{{{A}}}xfrm')
                for tag, attrs in [('off', {'x':'0', 'y':'0'}), ('ext', {'cx':'12192000','cy':'6858000'}),
                                   ('chOff', {'x':'0','y':'0'}), ('chExt', {'cx':'12192000','cy':'6858000'})]:
                    E.SubElement(transform, f'{{{A}}}{tag}', **attrs)
                for child in children[start:]:
                    tree.remove(child)
                    group.append(child)
                tree.append(group)
                timing = deepcopy(template)
                effect = timing.find('.//p:cTn[@nodeType="clickEffect"]/..', NS)
                assert effect is not None
                holder = effect.getparent()
                for branch in list(holder):
                    holder.remove(branch)
                effect = deepcopy(effect)
                for target in effect.findall('.//p:spTgt', NS):
                    target.set('spid', str(target_id))
                holder.append(effect)
                for i, t in enumerate(timing.findall('.//p:cTn', NS), 1):
                    t.set('id', str(i))
                old = xml.find('p:timing', NS)
                if old is not None:
                    xml.remove(old)
                ext = xml.find('p:extLst', NS)
                if ext is not None:
                    xml.insert(xml.index(ext), timing)
                else:
                    xml.append(timing)
                assert timing.xpath('.//@spid') == [str(target_id)]
                report['clickBuilds'].append({'slide': number, 'groupId': target_id, 'clicks': 1,
                                             'nativeObjects': len(list(group))-2})
            if number in [9, 10, 11]:
                report['nativeDiagrams'].append({'slide': number,
                    'connectors': len(xml.findall('.//p:cxnSp', NS)),
                    'editableText': len(xml.findall('.//p:sp/p:txBody', NS))})
            data = E.tostring(xml, xml_declaration=True, encoding='UTF-8', standalone=True)
        out.writestr(item, data)

(BUILD / 'native-object-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
