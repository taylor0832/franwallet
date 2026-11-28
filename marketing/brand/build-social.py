"""Build brand-native social artwork; requires fonttools and uharfbuzz."""
from pathlib import Path
import io
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'marketing/brand'
def font(name,weight):
 f=TTFont(ROOT/'assets/brand/fonts'/name);axes={a.axisTag for a in f['fvar'].axes}
 f=instantiateVariableFont(f,{k:v for k,v in {'wght':weight,'opsz':20,'SOFT':0,'WONK':1}.items() if k in axes})
 b=io.BytesIO();f.save(b);h=hb.Font(hb.Face(b.getvalue()));h.scale=(f['head'].unitsPerEm,)*2;hb.ot_font_set_funcs(h);return f,h
SERIF=font('Fraunces-variable.ttf',700);SANS=font('DM-Sans-variable.ttf',500)
def text(value,pair,size,x,y,color):
 f,h=pair;b=hb.Buffer();b.add_str(value);b.guess_segment_properties();hb.shape(h,b,{'kern':True});g=f.getGlyphSet();names=f.getGlyphOrder();cursor=0;paths=[]
 for info,pos in zip(b.glyph_infos,b.glyph_positions):
  p=SVGPathPen(g);g[names[info.codepoint]].draw(p);paths.append(f'<path transform="translate({cursor+pos.x_offset} {pos.y_offset})" d="{p.getCommands()}"/>');cursor+=pos.x_advance
 scale=size/f['head'].unitsPerEm
 return f'<g fill="{color}" transform="translate({x} {y}) scale({scale} {-scale})">'+''.join(paths)+'</g>'
icon=(ROOT/'assets/brand/franwallet-icon.svg').read_text();inside=icon[icon.index('>')+1:icon.rindex('</svg>')]
def card(name,width,height):
 square=width==height
 body='<rect width="1200" height="630" fill="#0A3D3D"/>'
 body+='<svg x="68" y="49" width="74" height="74" viewBox="0 0 256 256">'+inside+'</svg>'
 body+=text('FranWallet',SERIF,39,155,101,'#FFFFFF')
 body+=text('Your franchise.',SERIF,79,76,255,'#FFFFFF')
 body+=text('Organized by location.',SERIF,79,76,347,'#E8734A')
 for line,y in [('Company, banking, books, payroll and insurance.',439),('One Wallet for each franchise location.',482)]:body+=text(line,SANS,28,80,y,'#FFFFFF')
 body+=text('franwallet.com',SANS,22,80,566,'#FFFFFF')
 body+=text('Free to start',SANS,22,970,566,'#FFFFFF')
 if square:body='<rect width="1080" height="1080" fill="#0A3D3D"/><g transform="translate(0 256) scale(.9)">'+body+'</g>'
 else:body=f'<g transform="scale({width/1200} {height/630})">'+body+'</g>'
 (OUT/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img"><title>FranWallet. Your franchise. Organized by location.</title>{body}</svg>\n')
card('franwallet-social-1200x630.svg',1200,630)
card('franwallet-social-square.svg',1080,1080)
