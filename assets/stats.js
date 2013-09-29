var data = { raw: [], flat: {}, orig: {} }, // municipalities data
    codes = { by_code: {}, by_name: {}}, // municipalities codes
    quantize_functions = {},
    user = { width: 650, height: window.innerHeight - 50, mode: 'relative', statistic: '', table: 'desc'},
    map;

// util
var isObject = function(a) {
    return (!!a) && (a.constructor === Object);
};

// data functions
function strip_muni(kunta) {
    var i = kunta.indexOf(' '),
        k = i < 0 ? kunta.toLowerCase(): kunta.toLowerCase().substring(0, i);

    return k;
}

function find_muni(kunta) {
    return codes.by_name[strip_muni(kunta)] || 0;
}

function parse_data() {
    var i;

    function create_orig(d) {
        var code, i;

        for (i = 0; i < d.length; i++) {
            code = find_muni(d[i]['Main']['Taustamaanosa']);
            if (code !== 0) {
                // create empty object
                data['orig'][code] = data['orig'][code] || {};
                // create empty object
                data['orig'][code][d[i]['Main']['Syntyperä']] = data['orig'][code][d[i]['Main']['Syntyperä']] || {};
                data['orig'][code][d[i]['Main']['Syntyperä']] = d[i];
                delete data['orig'][code][d[i]['Main']['Syntyperä']]['Main'];
            }
        }
    }

    function create_flat(d, municipal, path) {
        for (i in d)
        {
            if (!municipal) {
                create_flat(d[i], parseInt(i));
            }
            else {
                data['flat'][municipal] = data['flat'][municipal] || {};

                if (typeof d[i] === 'object') {
                    create_flat(d[i], municipal, path? path + '.' + i: i);
                }
                else {
                    p = path + '.' + i;
                    r = d[i] / data['orig'][municipal]['Väestö yhteensä']['Sukupuolet yhteensä']['TAUSTAMAA YHTEENSÄ'];
                    data['flat'][municipal][path+'.'+i] = {
                        total: d[i],
                        relative: r,
                        relative_display: Math.round(r * 10000) / 100
                    };
                }
            }
        }
    }

    create_orig(data['raw']);
    create_flat(data['orig']);
}

function create_quantize_funtions() {
    var i, p;

    function isNumber(n) {
      return !isNaN(parseFloat(n)) && isFinite(n);
    }

    function compile_data(d, path) {
        for (i in d)
        {
            // is number - municipal
            if (isNumber(i)) {
                // strip first level (municipal) from the path
                compile_data(d[i]);
            }
            else {
                p = i;
                quantize_functions[p] = quantize_functions[p] || { q: { total: null, relative: null}, max: 0, sum: 0, min_relative: 1, max_relative: 0 }
                quantize_functions[p].max = Math.max(quantize_functions[p].max, parseInt(d[i].total));
                quantize_functions[p].max_relative = Math.max(quantize_functions[p].max_relative, d[i].relative);
                quantize_functions[p].min_relative = Math.min(quantize_functions[p].min_relative, d[i].relative);
                quantize_functions[p].sum += parseInt(d[i].total);
            }
        }
    }

    function clean_data() {
        for (i in quantize_functions) {
            if (quantize_functions[i].max === 0) {
                delete quantize_functions[i];
            }
        }

        // this one we don't want - it's 100% in every municipality
        delete quantize_functions['Väestö yhteensä.Sukupuolet yhteensä.TAUSTAMAA YHTEENSÄ'];
    }

    compile_data(data['flat']);
    clean_data();

    // create quantize functions
    for (i in quantize_functions) {

        quantize_functions[i].q.total = d3.scale.quantize()
            .domain([0, quantize_functions[i].max])
            .range(d3.range(16, 100, 1));

        quantize_functions[i].q.relative = d3.scale.quantize()
            .domain([quantize_functions[i].min_relative, quantize_functions[i].max_relative])
            .range(d3.range(16, 100, 1));
    }
}

function update_user_vars() {
    user.height = window.innerHeight - 100;
    user.statistic = d3.select('#statlist').property('value') || 'Väestö yhteensä.Sukupuolet yhteensä.Suomi';
    //user.mode = d3.select('#btns .active').attr('data-id');
}

function fill_select_box() {
    var statlist = d3.select('#statlist');

    for (var i in quantize_functions)
    {
        statlist.append('option').property('value', i).html(i.replace(/\./g, ' - '));
    }

    statlist.property('value', user.statistic);
    statlist.on('change', update_municipalities_table);
}

function update_municipalities_table() {
    var i,
        el,
        mun = []; // list of municipalities

    update_user_vars();
    d3.select('#sum').html(quantize_functions[user.statistic].sum)
    map.update_colors();

    for (i in data['flat']) {
        mun.push({ 'data-id': i, data: [ codes.by_code[i], data['flat'][i][user.statistic]['relative_display'] + ' %' ]});
    }

    TableSort(
        "#municipalities",
        [ { text: 'Kunta', sort: TableSort.alphabetic }, { text: 'Osuus', sort: TableSort.numeric, sort_column: true } ],
        mun,
        { width: '400px', height: '700px' }
    );

    d3.selectAll('#municipalities table.body-table tr').on('mouseenter', details.hover_enter)
    d3.selectAll('#municipalities table.body-table tr').on('mouseleave', details.hover_leave)
    d3.selectAll('#municipalities table.body-table tr').on('click', details.show)
}

var Map = (function() {
    var projection = d3.geo.transverseMercator().rotate([-27,-65,0]),
        path = d3.geo.path().projection(projection),
        self,
        tip,
        svg;

    function Map(_geometry) {
        self = this;
        self.geometry = _geometry;
    }

    function scale_projection() {
        projection.scale(user.height * 5.2);
        projection.translate([user.width/2, user.height/2]);
    }

    function color(d) {
        var mpal, hsl, x;

        /**
         * Converts an HSL color value to RGB. Conversion formula
         * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
         * Assumes h, s, and l are contained in the set [0, 1] and
         * returns r, g, and b in the set [0, 255].
         *
         * @param   Number  h       The hue
         * @param   Number  s       The saturation
         * @param   Number  l       The lightness
         * @return  Array           The RGB representation
         */
        function hslToRgb(h, s, l){
            var r, g, b;

            if(s == 0){
                r = g = b = l; // achromatic
            }else{
                function hue2rgb(p, q, t){
                    if(t < 0) t += 1;
                    if(t > 1) t -= 1;
                    if(t < 1/6) return p + (q - p) * 6 * t;
                    if(t < 1/2) return q;
                    if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                }

                var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                var p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }

            return [r * 255, g * 255, b * 255];
        }

        function hex(x) {
            return ("0" + parseInt(x).toString(16)).slice(-2);
        }

        mpal = d.properties.nationalCo;
        x = Math.abs(1 - quantize_functions[user.statistic].q[user.mode](data['flat'][mpal][user.statistic][user.mode]) / 100);
        hsl = hslToRgb(0.60, 0.8, x);
        return '#' + hex(hsl[0]) + hex(hsl[1]) + hex(hsl[2])
    }

    /*
    Map.prototype.bg = function(id) {
        id = parseInt(id);
        var projection, path;

        svg = d3.select('#bg').html(null).append('svg')
            .attr("width", window.innerWidth)
            .attr("height", window.innerHeight);

        console.log(svg)

        var projection = d3.geo.transverseMercator().rotate([-27,-65,0]),
            path = d3.geo.path().projection(projection);

        projection.scale(window.innerWidth * 5.2);
        projection.translate([window.innerWidth / 2, window.innerHeight / 2]);

        svg.selectAll("path")
            .data(topojson.feature(self.geometry, self.geometry.objects.layer1).features)
            .datum(function(d) { return d.properties.nationalCo === id? [d]: 0; })
            //.datum(function(d) { if (d.properties.nationalCo) { this.setAttribute('d', d) } })
            .append("path")
            .attr("d", path);
    }
    */

    Map.prototype.update_color = function(id, c) {
        svg.select("path[data-id='" + id + "']").attr('fill', c || color)
    }

    Map.prototype.update_colors = function() {
        svg.selectAll("path").attr("fill", color);
    }

    Map.prototype.draw = function() {
        update_user_vars();
        d3.select("svg").remove();
        tip = d3.tip().attr('class', 'd3-tip').offset([-15, 0]).html(function(d) { return codes.by_code[d.properties && d.properties.nationalCo || d]; });

        svg = d3.select("body").append("svg:svg")
            .attr("width", user.width)
            .attr("height", user.height);

        svg.call(tip);
        scale_projection();

        svg.selectAll("path")
            .data(topojson.feature(self.geometry, self.geometry.objects.layer1).features)
            .enter().append("path")
            .attr("fill", color)
            .attr("d", path)
            .datum(function(d) { this.setAttribute('data-id', d.properties.nationalCo); return d; });
            //.datum(function(d) { self['data-id'] = d.properties.nationalCo; return d; });

        d3.selectAll('svg path').on('mouseenter', self.hover_enter)
        d3.selectAll('svg path').on('mouseleave', self.hover_leave)
        d3.selectAll('svg path').on('click', details.show)
    }

    Map.prototype.hover_enter = function() {
        d3.select(this).attr('fill', '#dd3333')
        tip.show.apply(this, arguments);
    }

    Map.prototype.hover_leave = function() {
        d3.select(this).attr('fill', color)
        tip.hide.apply(this, arguments);
    }

    Map.prototype.click = function() {
        details.show();
    }

    return Map;
}());

// municipality details pane
var details = (function() {
    var details = {},
        details_el = d3.select('#details'),
        inner = details_el.append('div').classed('inner', true),
        table,
        table_el;

    d3.select('html').on('keydown', function() {
        if (d3.event.keyCode === 27) {
            details.hide();
        }
    });

    /*
    details.bg = function() {
        var projection, path;

        inner.select('svg').remove().append('svg')
            .attr("width", user.width)
            .attr("height", user.height);

        projection = d3.geo.transverseMercator().rotate([-27,-65,0]),
        path = d3.geo.path().projection(projection),

        projection.scale(inner.attr('height') * 5.2);
        projection.translate([inner.attr('width') / 2, inner.attr('height') / 2]);

        svg.selectAll("path")
            .data(topojson.feature(geometry, geometry.objects.layer1).features)
            .enter().append("path")
            .attr("fill", color)
            .attr("d", path)
            .datum(function(d) { this.setAttribute('data-id', d.properties.nationalCo); return d; });
            //.datum(function(d) { this['data-id'] = d.properties.nationalCo; return d; });

    }
    */

    details.hover_enter = function() {
        map.update_color(this.getAttribute('data-id'), '#dd3333');
    }

    details.hover_leave = function () {
        map.update_color(this.getAttribute('data-id'));
    }

    details.hide = function() {
        details_el.classed('show', false);
    };

    details.show = function() {
        function print_data(table, data, row, lv, gender) {
            var i, j = 1;

            for (i in data) {
                if (lv === 0)
                {
                    print_data(table, data[i], j, lv + 1, gender)
                    j += 1;
                }
                else if (lv === 1 && gender === i)
                {
                    print_data(table, data[i], row, lv + 1, gender)
                }
                else if (lv === 2)
                {
                    if (table[row + 1].selectAll('td')[0].length < 9) {
                        table[row + 1].append('td').text(data[i]);
                    }
                }
            }
        }

        function print_labels(table, data, lv, gender) {
            var i, j = 0, k;

            // first column
            if (lv === 1) {
                for (i in data) {
                    k = table.length;
                    table[k] = table_el.append('tr');
                    table[k].append('th').text(i);
                }
            }
            // first row
            else if (lv === 2) {
                if (table[0].selectAll('th')[0].length === 1) {
                    for (i in data) {
                        if (gender === i) {
                            table[0].append('th').attr('colspan', 9).text(i);
                        }
                    }
                }
            }
            // 2nd row
            else if (lv === 3) {
                if (table[1].selectAll('th')[0].length === 1) {
                    for (i in data) {
                        table[1].append('th').text(i);
                    }
                }
            }

            if (lv < 3) {
                for (i in data) {
                    print_labels(table, data[i], lv + 1, gender);
                }
            }
        }

        function print(id) {
            var i, arr = ['Sukupuolet yhteensä', 'Miehet', 'Naiset']

            table = [ [], [], [] ];
            inner.html(null).append('h2').text(codes.by_code[id]);

            for (i = 0; i < arr.length; i++) {

                table_el = inner.append('table')
                table[i][0] = table_el.append('tr');
                table[i][0].append('th');
                table[i][1] = table_el.append('tr');
                table[i][1].append('th');

                print_labels(table[i], data['orig'][id], 1, arr[i]);
                print_data(table[i], data['orig'][id], 0, 0, arr[i]);
            }
        }

        print(this.getAttribute('data-id'));
        details_el.classed('show', true);
    }

    return details;
}());

queue()
    .defer(d3.json, "data/kunnat.topo.json")
    .defer(d3.tsv, "data/koodit.tsv", function(d) {
        codes.by_code[parseInt(d.k)] = d.v;
        codes.by_name[strip_muni(d.v)] = parseInt(d.k);
    })
    .defer(csv2json.dsv(",", "text/plain", 2), "data/046_vaerak_tau_201-2.csv", function(d) {
        data['raw'].push(d);
    })
    .await(ready);

function ready(error, collection) {
    map = new Map(collection);
    parse_data();
    create_quantize_funtions();
    update_user_vars();
    fill_select_box();
    d3.select(window).on('resize', map.draw);
    map.draw();
    update_municipalities_table();
}

